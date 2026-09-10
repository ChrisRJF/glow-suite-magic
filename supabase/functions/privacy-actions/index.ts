import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { zipSync } from "https://esm.sh/fflate@0.8.2";
import { documentRef, renderPdf, type Block } from "../_shared/pdfDoc.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const EXPORT_BUCKET = "dossier-exports";
const CLINICAL_BUCKET = "clinical-files";
const MAX_PHOTOS = 100;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Capability = "export" | "archive" | "hold" | "pseudonymize" | "delete" | "retention";
interface Context {
  tenantId: string;
  actorId: string;
  isDemo: boolean;
  capabilities: Record<Capability, boolean>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/[<>]/g, "").slice(0, max) : "";
}

function uuid(value: unknown): string | null {
  const clean = text(value, 40);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null;
}

async function context(req: Request): Promise<Context | null> {
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return null;
  const [tenant, isDemo, exp, archive, hold, pseudonymize, del, retention] = await Promise.all([
    client.rpc("current_tenant_id"),
    client.rpc("current_tenant_is_demo"),
    client.rpc("can_privacy_export"),
    client.rpc("can_manage_privacy_archive"),
    client.rpc("can_manage_legal_hold"),
    client.rpc("can_pseudonymize_customer"),
    client.rpc("can_delete_customer_data"),
    client.rpc("can_manage_retention"),
  ]);
  if (!tenant.data) return null;
  return {
    tenantId: String(tenant.data),
    actorId: auth.user.id,
    isDemo: isDemo.data === true,
    capabilities: {
      export: exp.data === true,
      archive: archive.data === true,
      hold: hold.data === true,
      pseudonymize: pseudonymize.data === true,
      delete: del.data === true,
      retention: retention.data === true,
    },
  };
}

async function customer(ctx: Context, customerId: string) {
  const { data } = await admin.from("customers")
    .select("id,name,email,phone,is_demo,archived_at,pseudonymized_at,communication_blocked_at")
    .eq("user_id", ctx.tenantId).eq("id", customerId).maybeSingle();
  return data && Boolean(data.is_demo) === ctx.isDemo ? data : null;
}

async function audit(ctx: Context, action: string, requestId: string, details: Record<string, unknown> = {}) {
  await admin.from("audit_logs").insert({
    user_id: ctx.tenantId,
    actor_user_id: ctx.actorId,
    action,
    target_type: "privacy_request",
    target_id: requestId,
    is_demo: ctx.isDemo,
    details,
  }).then(() => {}, () => {});
}

async function createRequest(ctx: Context, customerId: string, type: string, key: string, includePhotos = false) {
  const { data, error } = await admin.from("privacy_requests").upsert({
    user_id: ctx.tenantId,
    is_demo: ctx.isDemo,
    customer_id: customerId,
    customer_ref: customerId,
    request_type: type,
    requested_by: ctx.actorId,
    idempotency_key: key,
    include_photos: includePhotos,
  }, { onConflict: "user_id,idempotency_key", ignoreDuplicates: false }).select("*").single();
  if (error) throw new Error(`request_create:${error.code || "failed"}`);
  return data;
}

async function preflight(ctx: Context, customerId: string) {
  const { data, error } = await admin.rpc("customer_privacy_preflight", {
    _tenant_id: ctx.tenantId,
    _customer_id: customerId,
  });
  if (error) throw new Error("preflight_failed");
  return data as Record<string, unknown>;
}

function snapshotBlocks(snapshot: Record<string, unknown>, salonName: string): Block[] {
  const c = (snapshot.customer || {}) as Record<string, unknown>;
  const count = (key: string) => Array.isArray(snapshot[key]) ? (snapshot[key] as unknown[]).length : 0;
  return [
    { t: "title", text: "Privacy-export persoonsgegevens" },
    { t: "subtitle", text: `Vaste momentopname uit ${salonName}` },
    { t: "heading", text: "Klantgegevens" },
    { t: "kv", label: "Naam", value: String(c.name || "-") },
    { t: "kv", label: "E-mail", value: String(c.email || "-") },
    { t: "kv", label: "Telefoon", value: String(c.phone || "-") },
    { t: "heading", text: "Overzicht" },
    { t: "kv", label: "Afspraken", value: String(count("appointments")) },
    { t: "kv", label: "Formulierverzoeken", value: String(count("form_requests")) },
    { t: "kv", label: "Ondertekende formulieren", value: String(count("form_submissions")) },
    { t: "kv", label: "Behandelverslagen", value: String(count("treatment_records")) },
    { t: "kv", label: "Fotoverwijzingen", value: String(count("media")) },
    { t: "kv", label: "Toestemmingsgebeurtenissen", value: String(count("consent_history")) },
    { t: "kv", label: "Communicatiegebeurtenissen", value: String(count("communications")) },
    { t: "space", size: 8 },
    { t: "muted", text: "data.json bevat de volledige, versiegebonden momentopname. Ondertekende documenten zijn niet gewijzigd." },
  ];
}

async function privacyExport(ctx: Context, body: Record<string, unknown>) {
  if (!ctx.capabilities.export) return json({ error: "forbidden" }, 403);
  const customerId = uuid(body.customer_id);
  if (!customerId || !(await customer(ctx, customerId))) return json({ error: "customer_not_found" }, 404);
  const includePhotos = body.include_photos === true;
  const key = text(body.idempotency_key, 100) || `privacy-export:${customerId}:${crypto.randomUUID()}`;
  const request = await createRequest(ctx, customerId, "privacy_export", key, includePhotos);
  if (request.status === "completed" && request.export_storage_path) {
    const { data } = await admin.storage.from(EXPORT_BUCKET).createSignedUrl(request.export_storage_path, 120);
    return json({ ok: true, reused: true, request, download_url: data?.signedUrl || null });
  }

  const asOf = new Date().toISOString();
  await admin.from("privacy_requests").update({ status: "in_progress", started_at: asOf }).eq("id", request.id);
  const { data: snapResult, error: snapError } = await admin.rpc("build_privacy_export_snapshot", {
    _tenant_id: ctx.tenantId,
    _customer_id: customerId,
    _as_of: asOf,
  });
  const result = snapResult as { ok?: boolean; snapshot?: Record<string, unknown> } | null;
  if (snapError || !result?.ok || !result.snapshot) throw new Error("snapshot_failed");

  const { data: settings } = await admin.from("settings").select("salon_name").eq("user_id", ctx.tenantId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const salonName = settings?.salon_name || "Salon";
  const ref = documentRef();
  const pdf = await renderPdf({ salonName, documentRef: ref, footerNote: "Privacy-export" }, snapshotBlocks(result.snapshot, salonName));
  const files: Record<string, Uint8Array> = {
    "persoonsgegevens.pdf": pdf,
    "data.json": new TextEncoder().encode(JSON.stringify(result.snapshot, null, 2)),
  };

  let photoCount = 0;
  if (includePhotos) {
    const { data: media } = await admin.from("clinical_media").select("id,storage_path,mime_type")
      .eq("user_id", ctx.tenantId).eq("customer_id", customerId).lte("created_at", asOf).limit(MAX_PHOTOS);
    for (const item of media || []) {
      if (!item.storage_path) continue;
      const { data } = await admin.storage.from(CLINICAL_BUCKET).download(item.storage_path);
      if (!data) continue;
      const extension = item.mime_type === "image/png" ? "png" : "jpg";
      files[`fotos/${item.id}.${extension}`] = new Uint8Array(await data.arrayBuffer());
      photoCount += 1;
    }
  }

  const bytes = zipSync(files, { level: 6 });
  const path = `${ctx.tenantId}/${customerId}/privacy-${request.id}-v1.zip`;
  const { error: uploadError } = await admin.storage.from(EXPORT_BUCKET).upload(path, bytes, {
    contentType: "application/zip",
    upsert: false,
  });
  if (uploadError) throw new Error("export_upload_failed");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await admin.from("privacy_requests").update({
    status: "completed",
    completed_at: new Date().toISOString(),
    snapshot_manifest: { schema_version: "1.0", as_of: asOf, format: "zip", photo_count: photoCount },
    export_storage_path: path,
    export_expires_at: expiresAt,
    result_summary: { generated: true, photo_count: photoCount },
  }).eq("id", request.id);
  await audit(ctx, "privacy_export_generated", request.id, { schema_version: "1.0", photo_count: photoCount });
  const { data: signed } = await admin.storage.from(EXPORT_BUCKET).createSignedUrl(path, 120);
  return json({ ok: true, request_id: request.id, expires_at: expiresAt, download_url: signed?.signedUrl || null });
}

async function cleanupStorage(ctx: Context, requestId: string) {
  const { data: rows } = await admin.from("privacy_storage_cleanup").select("id,bucket_id,object_path,attempts")
    .eq("user_id", ctx.tenantId).eq("privacy_request_id", requestId).in("status", ["pending", "retry", "failed"]).limit(200);
  let failed = 0;
  for (const row of rows || []) {
    await admin.from("privacy_storage_cleanup").update({ status: "processing", attempts: row.attempts + 1 }).eq("id", row.id);
    const { error } = await admin.storage.from(row.bucket_id).remove([row.object_path]);
    if (error) {
      failed += 1;
      await admin.from("privacy_storage_cleanup").update({
        status: row.attempts + 1 >= 5 ? "failed" : "retry",
        last_error: "storage_delete_failed",
        next_retry_at: new Date(Date.now() + Math.min(60, 2 ** row.attempts) * 60_000).toISOString(),
      }).eq("id", row.id);
    } else {
      await admin.from("privacy_storage_cleanup").update({ status: "completed", completed_at: new Date().toISOString(), last_error: null, next_retry_at: null }).eq("id", row.id);
    }
  }
  const { count } = await admin.from("privacy_storage_cleanup").select("id", { count: "exact", head: true })
    .eq("privacy_request_id", requestId).neq("status", "completed");
  if ((count || 0) === 0) {
    await admin.from("privacy_requests").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", requestId);
  }
  return { processed: rows?.length || 0, failed, pending: count || 0 };
}

async function execute(ctx: Context, body: Record<string, unknown>, action: "archive" | "restore" | "pseudonymize" | "delete") {
  const allowed = action === "archive" || action === "restore" ? ctx.capabilities.archive : action === "pseudonymize" ? ctx.capabilities.pseudonymize : ctx.capabilities.delete;
  if (!allowed) return json({ error: "forbidden" }, 403);
  const customerId = uuid(body.customer_id);
  if (!customerId || !(await customer(ctx, customerId))) return json({ error: "customer_not_found" }, 404);
  const key = text(body.idempotency_key, 100) || `${action}:${customerId}:${crypto.randomUUID()}`;
  if ((action === "pseudonymize" || action === "delete") && text(body.confirmation, 32) !== (action === "delete" ? "VERWIJDER" : "PSEUDONIMISEER")) {
    return json({ error: "confirmation_required" }, 400);
  }
  const first = await preflight(ctx, customerId);
  if (action === "delete" && first.blocked === true) return json({ error: "blocked", preflight: first }, 409);
  const request = await createRequest(ctx, customerId, action, key);
  const second = action === "delete" ? await preflight(ctx, customerId) : first;
  if (action === "delete" && second.blocked === true) return json({ error: "blocked", preflight: second }, 409);
  const { data, error } = await admin.rpc("execute_customer_privacy_action", {
    _request_id: request.id,
    _tenant_id: ctx.tenantId,
    _customer_id: customerId,
    _actor_id: ctx.actorId,
    _action: action,
  });
  if (error) throw new Error("action_failed");
  let cleanup = null;
  if (action === "delete" && (data as Record<string, unknown>)?.ok === true) cleanup = await cleanupStorage(ctx, request.id);
  return json({ ...(data as Record<string, unknown>), request_id: request.id, cleanup });
}

async function hold(ctx: Context, body: Record<string, unknown>, release: boolean) {
  if (!ctx.capabilities.hold) return json({ error: "forbidden" }, 403);
  const customerId = uuid(body.customer_id);
  if (!customerId || !(await customer(ctx, customerId))) return json({ error: "customer_not_found" }, 404);
  if (release) {
    const { error } = await admin.from("legal_holds").update({ released_at: new Date().toISOString(), released_by: ctx.actorId })
      .eq("user_id", ctx.tenantId).eq("customer_ref", customerId).is("released_at", null);
    if (error) throw new Error("hold_release_failed");
  } else {
    const reason = text(body.reason, 500);
    if (reason.length < 3) return json({ error: "reason_required" }, 400);
    const { error } = await admin.from("legal_holds").insert({ user_id: ctx.tenantId, is_demo: ctx.isDemo, customer_id: customerId, customer_ref: customerId, reason, created_by: ctx.actorId });
    if (error?.code === "23505") return json({ ok: true, unchanged: true });
    if (error) throw new Error("hold_create_failed");
  }
  const eventId = crypto.randomUUID();
  await audit(ctx, release ? "legal_hold_released" : "legal_hold_created", eventId, { customer_ref: customerId });
  return json({ ok: true });
}

async function getState(ctx: Context, customerId: string) {
  if (!(await customer(ctx, customerId))) return json({ error: "customer_not_found" }, 404);
  const [holdRow, requests, check] = await Promise.all([
    admin.from("legal_holds").select("id,reason,created_at,released_at").eq("user_id", ctx.tenantId).eq("customer_ref", customerId).is("released_at", null).maybeSingle(),
    admin.from("privacy_requests").select("id,request_type,status,requested_at,completed_at,failure_code,export_expires_at").eq("user_id", ctx.tenantId).eq("customer_ref", customerId).order("requested_at", { ascending: false }).limit(20),
    preflight(ctx, customerId),
  ]);
  return json({ ok: true, capabilities: ctx.capabilities, legal_hold: holdRow.data, requests: requests.data || [], preflight: check });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await context(req);
    if (!ctx) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = text(body.action, 40);
    const customerId = uuid(body.customer_id);
    if (action === "state") return customerId ? await getState(ctx, customerId) : json({ error: "customer_required" }, 400);
    if (action === "preflight") return customerId ? json({ ok: true, preflight: await preflight(ctx, customerId) }) : json({ error: "customer_required" }, 400);
    if (action === "export") return await privacyExport(ctx, body);
    if (["archive", "restore", "pseudonymize", "delete"].includes(action)) return await execute(ctx, body, action as "archive" | "restore" | "pseudonymize" | "delete");
    if (action === "hold") return await hold(ctx, body, false);
    if (action === "release_hold") return await hold(ctx, body, true);
    if (action === "retry_cleanup") {
      if (!ctx.capabilities.delete) return json({ error: "forbidden" }, 403);
      const requestId = uuid(body.request_id);
      return requestId ? json({ ok: true, cleanup: await cleanupStorage(ctx, requestId) }) : json({ error: "request_required" }, 400);
    }
    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    console.error("privacy_action_failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "server_error" }, 500);
  }
});