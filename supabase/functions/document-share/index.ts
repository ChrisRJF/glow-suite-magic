// Klantdossier P2a — public document viewer for the customer.
//
// The customer has no GlowSuite account. A share link gives access to exactly
// one generated document and nothing else: no dossier, no other documents, no
// customer object, no internal identifiers.
//
// Security:
// - only the SHA-256 hash of the token is stored
// - links expire, can be revoked and have a download limit
// - the stored file itself stays private; the download is a 60 second signed URL
// - rate limited per IP, reusing the existing public limiter

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { hashToken } from "../_shared/formCanonical.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "dossier-exports";
const TTL = 60;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}

async function rateLimit(bucket: string, max: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await admin.rpc("check_public_rate_limit", {
    _bucket: bucket, _max: max, _window_seconds: windowSeconds,
  });
  if (error) return true;
  return data !== false;
}

interface Resolved {
  share: { id: string; user_id: string; export_id: string; status: string; expires_at: string; download_count: number; max_downloads: number; first_viewed_at: string | null };
  doc: { id: string; storage_path: string | null; status: string; expires_at: string; document_ref: string; format: string; scope: string };
}

async function resolve(token: string): Promise<Resolved | { error: string; status: number }> {
  if (!/^[a-f0-9]{64}$/.test(token)) return { error: "not_found", status: 404 };
  const token_hash = await hashToken(token);
  const { data: share } = await admin
    .from("document_shares")
    .select("id, user_id, export_id, status, expires_at, download_count, max_downloads, first_viewed_at")
    .eq("token_hash", token_hash)
    .maybeSingle();
  if (!share) return { error: "not_found", status: 404 };
  if (share.status !== "active") return { error: "revoked", status: 410 };
  if (new Date(share.expires_at).getTime() < Date.now()) return { error: "expired", status: 410 };
  if (share.download_count >= share.max_downloads) return { error: "limit_reached", status: 410 };

  const { data: doc } = await admin
    .from("document_exports")
    .select("id, storage_path, status, expires_at, document_ref, format, scope, user_id")
    .eq("id", share.export_id)
    .maybeSingle();
  // Cross-document isolation: the file must belong to the same salon as the share.
  if (!doc || doc.user_id !== share.user_id) return { error: "not_found", status: 404 };
  if (doc.status !== "ready" || !doc.storage_path) return { error: "expired", status: 410 };
  if (new Date(doc.expires_at).getTime() < Date.now()) return { error: "expired", status: 410 };

  return { share: share as Resolved["share"], doc: doc as unknown as Resolved["doc"] };
}

const SCOPE_LABEL: Record<string, string> = {
  form: "Formulier",
  treatment_record: "Behandelverslag",
  appointment_bundle: "Dossierbundel",
  full_dossier: "Klantdossier",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "get");
    const token = String(body.token ?? "");

    if (!(await rateLimit(`doc_share_${clientIp(req)}`, 30, 300))) return json({ error: "rate_limited" }, 429);

    const resolved = await resolve(token);
    if ("error" in resolved) return json({ error: resolved.error }, resolved.status);
    const { share, doc } = resolved;

    const { data: settings } = await admin
      .from("settings").select("salon_name").eq("user_id", share.user_id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const salon = settings?.salon_name || "je salon";

    if (action === "get") {
      if (!share.first_viewed_at) {
        await admin.from("document_shares").update({ first_viewed_at: new Date().toISOString() }).eq("id", share.id);
      }
      return json({
        ok: true,
        salon_name: salon,
        document_type: SCOPE_LABEL[doc.scope] || "Document",
        document_ref: doc.document_ref,
        format: doc.format,
        expires_at: share.expires_at,
        downloads_left: share.max_downloads - share.download_count,
      });
    }

    if (action === "download") {
      // Atomic reservation: status, expiry, revoke and limit are checked and the
      // counter is incremented inside one database statement, so two simultaneous
      // downloads can never both consume the last remaining download.
      const { data: claimRaw, error: claimErr } = await admin.rpc("consume_document_share_download", {
        _token_hash: await hashToken(token),
      });
      const claim = (claimRaw ?? {}) as { ok?: boolean; error?: string; share_id?: string };
      if (claimErr || !claim.ok) {
        const code = claim.error ?? "unavailable";
        const status = code === "not_found" ? 404 : code === "unavailable" ? 500 : 410;
        return json({ error: code }, status);
      }

      const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUrl(doc.storage_path!, TTL, {
        download: `${doc.document_ref}.${doc.format}`,
      });
      if (error || !signed?.signedUrl) {
        // Nothing was delivered: give the reserved download back.
        await admin.rpc("release_document_share_download", { _share_id: claim.share_id }).then(() => {}, () => {});
        return json({ error: "unavailable" }, 500);
      }

      // No token, no URL and no content in the audit trail.
      await admin.from("audit_logs").insert({
        user_id: share.user_id,
        action: "dossier_export_downloaded",
        target_type: "document_share",
        target_id: share.id,
        details: { by: "customer", scope: doc.scope },
      }).then(() => {}, () => {});

      return json({ ok: true, url: signed.signedUrl, expires_in: TTL });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("document_share_error", (e as Error).message);
    return json({ error: "server_error" }, 500);
  }
});
