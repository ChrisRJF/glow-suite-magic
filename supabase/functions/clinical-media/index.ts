// Klantdossier P0b — clinical photos (private storage only).
//
// Actions (all require a staff JWT):
//   upload  -> validates tenant/customer/appointment/mime/size, stores in the
//              private clinical-files bucket and records the row.
//   sign    -> short lived signed URL for viewing one image.
//   remove  -> deletes the file and its row (managers only), always audited.
//
// The browser never supplies a tenant id and never touches storage directly.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BUCKET = "clinical-files";
const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_BYTES = 8 * 1024 * 1024;
const CATEGORIES = ["before", "after", "control", "other"];

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Ctx {
  tenantId: string;
  actorId: string;
  isDemo: boolean;
  mayContent: boolean;
  mayManage: boolean;
}

async function resolveContext(req: Request): Promise<Ctx | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return null;
  const [{ data: tenantId }, { data: mayContent }, { data: mayManage }, { data: isDemo }] = await Promise.all([
    userClient.rpc("current_tenant_id"),
    userClient.rpc("can_view_dossier_content"),
    userClient.rpc("can_manage_form_templates"),
    userClient.rpc("current_tenant_is_demo"),
  ]);
  if (!tenantId) return null;
  return {
    tenantId: String(tenantId),
    actorId: userData.user.id,
    isDemo: isDemo === true,
    mayContent: mayContent === true,
    mayManage: mayManage === true,
  };
}

async function audit(ctx: Ctx, action: string, targetId: string, details: Record<string, unknown>) {
  // Never store content, captions, file bytes or signed URLs.
  await admin.from("audit_logs").insert({
    user_id: ctx.tenantId,
    actor_user_id: ctx.actorId,
    action,
    target_type: "clinical_media",
    target_id: targetId,
    is_demo: ctx.isDemo,
    details,
  });
}

function decodeBase64(input: string): Uint8Array | null {
  try {
    const clean = input.includes(",") ? input.slice(input.indexOf(",") + 1) : input;
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Magic-byte check so a renamed executable can never pass as an image. */
function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  return null;
}

async function handleUpload(ctx: Ctx, body: Record<string, unknown>) {
  if (!ctx.mayContent) return json({ error: "forbidden" }, 403);

  const customerId = String(body.customer_id ?? "");
  const appointmentId = body.appointment_id ? String(body.appointment_id) : null;
  const recordId = body.treatment_record_id ? String(body.treatment_record_id) : null;
  const category = CATEGORIES.includes(String(body.category)) ? String(body.category) : "other";
  const caption = body.caption ? String(body.caption).replace(/[<>]/g, "").slice(0, 200) : null;
  if (!customerId) return json({ error: "customer_required" }, 400);

  const bytes = decodeBase64(String(body.data_base64 ?? ""));
  if (!bytes || bytes.length === 0) return json({ error: "invalid_file" }, 400);
  if (bytes.length > MAX_BYTES) return json({ error: "file_too_large" }, 400);

  const sniffed = sniffMime(bytes);
  if (!sniffed || !ALLOWED_MIME[sniffed]) return json({ error: "unsupported_file_type" }, 400);

  const { data: customer } = await admin
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("user_id", ctx.tenantId)
    .maybeSingle();
  if (!customer) return json({ error: "customer_not_found" }, 404);

  if (appointmentId) {
    const { data: appt } = await admin
      .from("appointments")
      .select("id, customer_id")
      .eq("id", appointmentId)
      .eq("user_id", ctx.tenantId)
      .maybeSingle();
    if (!appt || appt.customer_id !== customerId) return json({ error: "appointment_mismatch" }, 400);
  }
  if (recordId) {
    const { data: rec } = await admin
      .from("treatment_records")
      .select("id, customer_id")
      .eq("id", recordId)
      .eq("user_id", ctx.tenantId)
      .maybeSingle();
    if (!rec || rec.customer_id !== customerId) return json({ error: "record_mismatch" }, 400);
  }

  // Tenant-safe path, no names or medical wording in the file name.
  const ext = ALLOWED_MIME[sniffed];
  const path = `${ctx.tenantId}/${customerId}/${appointmentId ?? "geen-afspraak"}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: sniffed,
    upsert: false,
  });
  if (upErr) {
    console.error("clinical_media_upload_failed", upErr.message);
    return json({ error: "upload_failed" }, 500);
  }

  const { data: row, error: insErr } = await admin
    .from("clinical_media")
    .insert({
      user_id: ctx.tenantId,
      is_demo: ctx.isDemo,
      customer_id: customerId,
      appointment_id: appointmentId,
      treatment_record_id: recordId,
      employee_id: null,
      category,
      storage_path: path,
      caption,
      mime_type: sniffed,
      size_bytes: bytes.length,
    })
    .select("id, category, created_at, caption")
    .single();
  if (insErr) {
    await admin.storage.from(BUCKET).remove([path]);
    console.error("clinical_media_insert_failed", insErr.message);
    return json({ error: "save_failed" }, 500);
  }

  await audit(ctx, "clinical_media_uploaded", row.id, { category, size_bytes: bytes.length, mime_type: sniffed });
  return json({ ok: true, media: row });
}

async function handleSign(ctx: Ctx, body: Record<string, unknown>) {
  if (!ctx.mayContent) return json({ error: "forbidden" }, 403);
  const mediaId = String(body.media_id ?? "");
  const { data: media } = await admin
    .from("clinical_media")
    .select("id, storage_path, is_demo")
    .eq("id", mediaId)
    .eq("user_id", ctx.tenantId)
    .maybeSingle();
  if (!media || media.is_demo !== ctx.isDemo) return json({ error: "not_found" }, 404);

  const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUrl(media.storage_path, 120);
  if (error || !signed?.signedUrl) return json({ error: "sign_failed" }, 500);

  await audit(ctx, "clinical_media_viewed", media.id, { ttl_seconds: 120 });
  return json({ ok: true, url: signed.signedUrl, expires_in: 120 });
}

async function handleRemove(ctx: Ctx, body: Record<string, unknown>) {
  if (!ctx.mayManage) return json({ error: "forbidden" }, 403);
  const mediaId = String(body.media_id ?? "");
  const { data: media } = await admin
    .from("clinical_media")
    .select("id, storage_path, category")
    .eq("id", mediaId)
    .eq("user_id", ctx.tenantId)
    .maybeSingle();
  if (!media) return json({ error: "not_found" }, 404);

  await admin.storage.from(BUCKET).remove([media.storage_path]);
  const { error } = await admin.from("clinical_media").delete().eq("id", media.id).eq("user_id", ctx.tenantId);
  if (error) return json({ error: "delete_failed" }, 500);

  await audit(ctx, "clinical_media_deleted", media.id, { category: media.category });
  return json({ ok: true });
}

/**
 * P2b-1: per photo marketing approval. Approval alone is never enough:
 * marketing use also requires a current "granted" consent for the scope.
 */
async function handleMarketingApproval(ctx: Ctx, body: Record<string, unknown>) {
  if (!ctx.mayManage) return json({ error: "forbidden" }, 403);
  const mediaId = String(body.media_id ?? "");
  const approved = body.approved === true;

  const { data: media } = await admin
    .from("clinical_media")
    .select("id, customer_id, is_demo")
    .eq("id", mediaId)
    .eq("user_id", ctx.tenantId)
    .maybeSingle();
  if (!media || media.is_demo !== ctx.isDemo) return json({ error: "not_found" }, 404);

  if (approved) {
    const { data: status } = await admin.rpc("current_consent_status", {
      _customer_id: media.customer_id,
      _scope: "marketing_general",
    });
    if (status !== "granted") return json({ error: "consent_missing" }, 409);
  }

  const { error } = await admin
    .from("clinical_media")
    .update({
      marketing_approved: approved,
      marketing_approved_at: approved ? new Date().toISOString() : null,
      marketing_approved_by: approved ? ctx.actorId : null,
    })
    .eq("id", media.id)
    .eq("user_id", ctx.tenantId);
  if (error) return json({ error: "save_failed" }, 500);

  await audit(ctx, approved ? "clinical_media_marketing_approved" : "clinical_media_marketing_revoked", media.id, {});
  return json({ ok: true, marketing_approved: approved });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const ctx = await resolveContext(req);
    if (!ctx) return json({ error: "unauthorized" }, 401);

    if (action === "upload") return await handleUpload(ctx, body);
    if (action === "sign") return await handleSign(ctx, body);
    if (action === "remove") return await handleRemove(ctx, body);
    if (action === "set_marketing_approval") return await handleMarketingApproval(ctx, body);
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("clinical_media_error", (e as Error).message);
    return json({ error: "server_error" }, 500);
  }
});
