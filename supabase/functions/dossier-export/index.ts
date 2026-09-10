// Klantdossier P2a — server-side dossier export, secure download and sharing.
//
// Actions (staff JWT required):
//   create  -> builds a PDF (or ZIP when photos are selected), stores it in the
//              private dossier-exports bucket and records document_exports.
//   list    -> recent exports for one customer.
//   download-> short lived signed URL for the requesting salon only.
//   share   -> creates a customer share link; only the token hash is stored.
//   revoke  -> revokes a share link.
//
// Rules enforced here, never in the browser:
// - tenant comes from current_tenant_id(), never from the request body
// - content roles only (reception and finance are refused)
// - photos are opt-in and must be explicitly selected
// - documents render from immutable snapshots, never from live templates
// - form snapshots are hash-verified before they are allowed into a document

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { zipSync } from "https://esm.sh/fflate@0.8.2";
import { generateFormToken, hashToken } from "../_shared/formCanonical.ts";
import { documentRef, nlDate, renderPdf, type Block } from "../_shared/pdfDoc.ts";
import {
  alertBlocks,
  appointmentLabel,
  customerHeaderBlocks,
  formBlocks,
  timelineBlocks,
  treatmentBlocks,
  verifySubmissionHash,
  type RecordRow,
  type SubmissionRow,
} from "./build.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BUCKET = "dossier-exports";
const CLINICAL_BUCKET = "clinical-files";
const DOWNLOAD_TTL = 120;
const EXPORT_TTL_DAYS = 7;
const MAX_PHOTOS = 40;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function publicAppOrigin(): string {
  return Deno.env.get("APP_PUBLIC_URL") || "https://glowsuite.nl";
}

interface Ctx {
  tenantId: string;
  actorId: string;
  isDemo: boolean;
  mayContent: boolean;
  mayShare: boolean;
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
  const [{ data: tenantId }, { data: mayContent }, { data: mayShare }, { data: isDemo }] = await Promise.all([
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
    mayShare: mayShare === true,
  };
}

/** Audit never stores answers, photo paths, signed URLs or tokens. */
async function audit(ctx: Ctx, action: string, targetId: string, details: Record<string, unknown>) {
  await admin.from("audit_logs").insert({
    user_id: ctx.tenantId,
    actor_user_id: ctx.actorId,
    action,
    target_type: "document_export",
    target_id: targetId,
    is_demo: ctx.isDemo,
    details,
  }).then(() => {}, () => {});
}

/** Best effort housekeeping: removes files whose export window has passed. */
async function cleanupExpired(tenantId: string) {
  const { data: stale } = await admin
    .from("document_exports")
    .select("id, storage_path")
    .eq("user_id", tenantId)
    .not("storage_path", "is", null)
    .lt("expires_at", new Date().toISOString())
    .limit(25);
  if (!stale || stale.length === 0) return;
  const paths = stale.map((r) => r.storage_path as string).filter(Boolean);
  if (paths.length > 0) await admin.storage.from(BUCKET).remove(paths);
  await admin
    .from("document_exports")
    .update({ storage_path: null, status: "failed", error_code: "expired" })
    .in("id", stale.map((r) => r.id));
  await admin
    .from("document_shares")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .in("export_id", stale.map((r) => r.id))
    .eq("status", "active");
}

async function salonName(tenantId: string): Promise<string> {
  const { data } = await admin
    .from("settings")
    .select("salon_name")
    .eq("user_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.salon_name || "Salon";
}

function safeName(input: string): string {
  return input.normalize("NFKD").replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "-").slice(0, 48) || "dossier";
}

// -------------------------------------------------------------------- create
async function handleCreate(ctx: Ctx, body: Record<string, unknown>) {
  if (!ctx.mayContent) return json({ error: "forbidden" }, 403);

  const scope = String(body.scope ?? "");
  if (!["form", "treatment_record", "appointment_bundle", "full_dossier"].includes(scope)) {
    return json({ error: "invalid_scope" }, 400);
  }
  const customerId = String(body.customer_id ?? "");
  if (!customerId) return json({ error: "customer_required" }, 400);
  const appointmentId = body.appointment_id ? String(body.appointment_id) : null;
  const sourceId = body.source_id ? String(body.source_id) : null;
  const includePhotos = body.include_photos === true;
  const mediaIds = Array.isArray(body.media_ids) ? body.media_ids.map(String).slice(0, MAX_PHOTOS) : [];
  const idempotencyKey = body.idempotency_key ? String(body.idempotency_key).slice(0, 80) : null;
  const sectionsRaw = (body.sections ?? {}) as Record<string, unknown>;
  const sections = {
    customer: sectionsRaw.customer !== false,
    forms: sectionsRaw.forms !== false,
    treatments: sectionsRaw.treatments !== false,
    alerts: sectionsRaw.alerts !== false,
    timeline: sectionsRaw.timeline !== false,
  };

  // Idempotency: the same click twice returns the same document.
  if (idempotencyKey) {
    const { data: existing } = await admin
      .from("document_exports")
      .select("id, status, document_ref, format, expires_at, storage_path")
      .eq("user_id", ctx.tenantId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing && existing.status === "ready" && existing.storage_path) {
      return json({ ok: true, reused: true, export: existing });
    }
    if (existing) await admin.from("document_exports").delete().eq("id", existing.id);
  }

  const { data: customer } = await admin
    .from("customers")
    .select("id, name, email, phone, created_at, is_demo")
    .eq("id", customerId)
    .eq("user_id", ctx.tenantId)
    .maybeSingle();
  if (!customer) return json({ error: "customer_not_found" }, 404);
  if (Boolean(customer.is_demo) !== ctx.isDemo) return json({ error: "customer_not_found" }, 404);

  let appointment: { id: string; appointment_date: string; start_time: string | null; service_id: string | null; employee_id: string | null } | null = null;
  if (appointmentId) {
    const { data } = await admin
      .from("appointments")
      .select("id, appointment_date, start_time, service_id, employee_id, customer_id")
      .eq("id", appointmentId)
      .eq("user_id", ctx.tenantId)
      .maybeSingle();
    if (!data || data.customer_id !== customerId) return json({ error: "appointment_mismatch" }, 400);
    appointment = data as typeof appointment;
  }

  const ref = documentRef();
  const salon = await salonName(ctx.tenantId);
  const meta = { salonName: salon, documentRef: ref, footerNote: `Dossierdocument voor ${customer.name}` };

  const { data: exportRow, error: insErr } = await admin
    .from("document_exports")
    .insert({
      user_id: ctx.tenantId,
      is_demo: ctx.isDemo,
      customer_id: customerId,
      appointment_id: appointmentId,
      scope,
      source_id: sourceId,
      include_photos: includePhotos && mediaIds.length > 0,
      format: "pdf",
      status: "pending",
      document_ref: ref,
      idempotency_key: idempotencyKey,
      requested_by: ctx.actorId,
      expires_at: new Date(Date.now() + EXPORT_TTL_DAYS * 86400000).toISOString(),
    })
    .select("id")
    .single();
  if (insErr || !exportRow) {
    if (insErr?.code === "23505") return json({ error: "already_running" }, 409);
    console.error("document_export_insert_failed", insErr?.message);
    return json({ error: "export_failed" }, 500);
  }
  await audit(ctx, "dossier_export_requested", exportRow.id, { scope, include_photos: includePhotos });

  try {
    const built = await buildDocument({
      ctx, scope, customer, appointment, sourceId, sections,
      includePhotos, mediaIds, meta,
    });
    if ("error" in built) {
      await admin.from("document_exports").update({ status: "failed", error_code: built.error }).eq("id", exportRow.id);
      await audit(ctx, "dossier_export_failed", exportRow.id, { scope, reason: built.error });
      return json({ error: built.error }, built.status ?? 400);
    }

    const path = `${ctx.tenantId}/${customerId}/${exportRow.id}.${built.format}`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, built.bytes, {
      contentType: built.format === "zip" ? "application/zip" : "application/pdf",
      upsert: true,
    });
    if (upErr) throw new Error(upErr.message);

    await admin.from("document_exports").update({
      status: "ready",
      storage_path: path,
      format: built.format,
      file_bytes: built.bytes.length,
      photo_count: built.photoCount,
    }).eq("id", exportRow.id);

    await audit(ctx, "dossier_export_generated", exportRow.id, {
      scope, format: built.format, photo_count: built.photoCount, file_bytes: built.bytes.length,
    });

    return json({
      ok: true,
      export: {
        id: exportRow.id, status: "ready", document_ref: ref, format: built.format,
        photo_count: built.photoCount, file_bytes: built.bytes.length,
      },
    });
  } catch (e) {
    console.error("document_export_build_failed", (e as Error).message);
    await admin.from("document_exports").update({ status: "failed", error_code: "build_failed" }).eq("id", exportRow.id);
    await audit(ctx, "dossier_export_failed", exportRow.id, { scope, reason: "build_failed" });
    return json({ error: "export_failed" }, 500);
  } finally {
    cleanupExpired(ctx.tenantId).catch(() => {});
  }
}

interface BuildArgs {
  ctx: Ctx;
  scope: string;
  customer: { id: string; name: string; email: string | null; phone: string | null; created_at: string };
  appointment: { id: string; appointment_date: string; start_time: string | null; service_id: string | null; employee_id: string | null } | null;
  sourceId: string | null;
  sections: Record<string, boolean>;
  includePhotos: boolean;
  mediaIds: string[];
  meta: { salonName: string; documentRef: string; footerNote?: string };
}

type BuildResult =
  | { bytes: Uint8Array; format: "pdf" | "zip"; photoCount: number }
  | { error: string; status?: number };

async function serviceNames(tenantId: string, ids: string[]): Promise<Record<string, string>> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (clean.length === 0) return {};
  const { data } = await admin.from("services").select("id, name").eq("user_id", tenantId).in("id", clean);
  return Object.fromEntries((data || []).map((s) => [s.id as string, s.name as string]));
}

async function employeeNames(tenantId: string, ids: string[]): Promise<Record<string, string>> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (clean.length === 0) return {};
  const { data } = await admin.from("employees").select("id, name").eq("user_id", tenantId).in("id", clean);
  return Object.fromEntries((data || []).map((s) => [s.id as string, s.name as string]));
}


/** Timeline wording stays in plain Dutch, whatever the stored status value is. */
function apptStatusLabel(status: string | null): string {
  const s = (status || "").toLowerCase();
  if (["voltooid", "completed", "afgerond", "done"].includes(s)) return "afgerond";
  if (["geannuleerd", "cancelled", "canceled", "declined"].includes(s)) return "geannuleerd";
  if (["no_show", "no-show", "noshow", "niet_verschenen"].includes(s)) return "niet verschenen";
  if (["confirmed", "bevestigd"].includes(s)) return "bevestigd";
  if (["gepland", "planned", "pending", "scheduled"].includes(s)) return "gepland";
  return s || "gepland";
}

async function buildDocument(args: BuildArgs): Promise<BuildResult> {
  const { ctx, scope, customer, appointment, sourceId, sections, includePhotos, mediaIds, meta } = args;
  const blocks: Block[] = [];

  const apptServices = await serviceNames(ctx.tenantId, appointment?.service_id ? [appointment.service_id] : []);
  const apptLabel = appointmentLabel(appointment, appointment?.service_id ? apptServices[appointment.service_id] ?? null : null);

  if (scope === "form") {
    if (!sourceId) return { error: "submission_required" };
    const { data } = await admin
      .from("form_submissions")
      .select("id, rendered_snapshot, document_hash, signer_name, signed_at, submitted_at, appointment_id, audit_metadata, customer_id, is_demo")
      .eq("id", sourceId)
      .eq("user_id", ctx.tenantId)
      .maybeSingle();
    if (!data || data.customer_id !== customer.id) return { error: "submission_not_found", status: 404 };
    const row = data as unknown as SubmissionRow;
    if (!(await verifySubmissionHash(row))) return { error: "hash_mismatch", status: 409 };
    blocks.push(...formBlocks(row, customer.name, apptLabel));
  } else if (scope === "treatment_record") {
    if (!sourceId) return { error: "record_required" };
    const { data } = await admin
      .from("treatment_records")
      .select("id, template_snapshot, values, template_version, status, completed_at, appointment_id, service_id, employee_id, customer_id")
      .eq("id", sourceId)
      .eq("user_id", ctx.tenantId)
      .maybeSingle();
    if (!data || data.customer_id !== customer.id) return { error: "record_not_found", status: 404 };
    if (data.status !== "completed") return { error: "record_not_completed", status: 409 };
    const svc = await serviceNames(ctx.tenantId, [data.service_id as string]);
    const emp = await employeeNames(ctx.tenantId, [data.employee_id as string]);
    const row: RecordRow = {
      ...(data as unknown as RecordRow),
      service_name: svc[data.service_id as string] ?? null,
      employee_name: emp[data.employee_id as string] ?? null,
    };
    blocks.push(...treatmentBlocks(row, customer.name, apptLabel, null));
  } else if (scope === "appointment_bundle") {
    if (!appointment) return { error: "appointment_required" };
    blocks.push({ t: "title", text: "Dossierbundel" });
    blocks.push({ t: "subtitle", text: `${customer.name} · ${apptLabel ?? nlDate(appointment.appointment_date)}` });
    blocks.push({ t: "rule" });

    const [{ data: subs }, { data: recs }] = await Promise.all([
      admin.from("form_submissions")
        .select("id, rendered_snapshot, document_hash, signer_name, signed_at, submitted_at, appointment_id, audit_metadata")
        .eq("user_id", ctx.tenantId).eq("customer_id", customer.id).eq("appointment_id", appointment.id),
      admin.from("treatment_records")
        .select("id, template_snapshot, values, template_version, status, completed_at, appointment_id, service_id, employee_id")
        .eq("user_id", ctx.tenantId).eq("customer_id", customer.id).eq("appointment_id", appointment.id).eq("status", "completed"),
    ]);

    for (const s of (subs || []) as unknown as SubmissionRow[]) {
      if (!(await verifySubmissionHash(s))) return { error: "hash_mismatch", status: 409 };
      blocks.push(...formBlocks(s, customer.name, apptLabel));
      blocks.push({ t: "space", size: 16 });
    }
    const svc = await serviceNames(ctx.tenantId, (recs || []).map((r) => r.service_id as string));
    const emp = await employeeNames(ctx.tenantId, (recs || []).map((r) => r.employee_id as string));
    for (const r of (recs || []) as unknown as RecordRow[]) {
      blocks.push(...treatmentBlocks(
        { ...r, service_name: svc[(r as unknown as { service_id: string }).service_id] ?? null, employee_name: emp[(r as unknown as { employee_id: string }).employee_id] ?? null },
        customer.name, apptLabel, null,
      ));
      blocks.push({ t: "space", size: 16 });
    }
    if ((subs || []).length === 0 && (recs || []).length === 0) {
      blocks.push({ t: "muted", text: "Er zijn nog geen ingevulde formulieren of afgeronde verslagen bij deze afspraak." });
    }
  } else {
    // full_dossier
    blocks.push(...customerHeaderBlocks(customer, sections));

    if (sections.forms) {
      const { data: subs } = await admin
        .from("form_submissions")
        .select("id, rendered_snapshot, document_hash, signer_name, signed_at, submitted_at, appointment_id, audit_metadata")
        .eq("user_id", ctx.tenantId).eq("customer_id", customer.id).order("submitted_at", { ascending: true }).limit(100);
      blocks.push({ t: "heading", text: "Formulieren en toestemmingen" });
      if (!subs || subs.length === 0) blocks.push({ t: "muted", text: "Geen ingevulde formulieren." });
      for (const s of (subs || []) as unknown as SubmissionRow[]) {
        if (!(await verifySubmissionHash(s))) return { error: "hash_mismatch", status: 409 };
        blocks.push({ t: "space", size: 6 });
        blocks.push(...formBlocks(s, customer.name, null));
        blocks.push({ t: "space", size: 12 });
      }
    }

    if (sections.treatments) {
      const { data: recs } = await admin
        .from("treatment_records")
        .select("id, template_snapshot, values, template_version, status, completed_at, appointment_id, service_id, employee_id")
        .eq("user_id", ctx.tenantId).eq("customer_id", customer.id).eq("status", "completed")
        .order("completed_at", { ascending: true }).limit(100);
      blocks.push({ t: "heading", text: "Behandelverslagen" });
      if (!recs || recs.length === 0) blocks.push({ t: "muted", text: "Geen afgeronde behandelverslagen." });
      const svc = await serviceNames(ctx.tenantId, (recs || []).map((r) => r.service_id as string));
      const emp = await employeeNames(ctx.tenantId, (recs || []).map((r) => r.employee_id as string));
      for (const r of (recs || []) as unknown as RecordRow[]) {
        blocks.push({ t: "space", size: 6 });
        blocks.push(...treatmentBlocks(
          { ...r, service_name: svc[(r as unknown as { service_id: string }).service_id] ?? null, employee_name: emp[(r as unknown as { employee_id: string }).employee_id] ?? null },
          customer.name, null, null,
        ));
        blocks.push({ t: "space", size: 12 });
      }
    }

    if (sections.alerts) {
      const { data: alerts } = await admin
        .from("customer_alerts").select("label, created_at, review_status")
        .eq("user_id", ctx.tenantId).eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(50);
      blocks.push(...alertBlocks((alerts || []) as Array<{ label: string; created_at: string; review_status: string }>));
    }

    if (sections.timeline) {
      // The timeline RPC is scoped to a signed in staff member, so it cannot be
      // used from the service role. The same events are assembled here instead.
      const [{ data: appts }, { data: subs2 }, { data: recs2 }] = await Promise.all([
        admin.from("appointments").select("appointment_date, service_id, status")
          .eq("user_id", ctx.tenantId).eq("customer_id", customer.id).eq("is_demo", ctx.isDemo)
          .order("appointment_date", { ascending: false }).limit(60),
        admin.from("form_submissions").select("submitted_at, rendered_snapshot, signed_at")
          .eq("user_id", ctx.tenantId).eq("customer_id", customer.id)
          .order("submitted_at", { ascending: false }).limit(60),
        admin.from("treatment_records").select("completed_at, created_at, status")
          .eq("user_id", ctx.tenantId).eq("customer_id", customer.id)
          .order("created_at", { ascending: false }).limit(60),
      ]);
      const svcTl = await serviceNames(ctx.tenantId, (appts || []).map((a) => a.service_id as string));
      const items: Array<{ occurred_at: string; label: string; category: string }> = [];
      for (const a of appts || []) {
        items.push({
          occurred_at: a.appointment_date as string,
          category: "treatments",
          label: `${svcTl[a.service_id as string] ?? "Afspraak"} (${apptStatusLabel(a.status as string | null)})`,
        });
      }
      for (const s of subs2 || []) {
        const title = String((s.rendered_snapshot as Record<string, unknown> | null)?.title ?? "Formulier");
        items.push({
          occurred_at: s.submitted_at as string,
          category: "forms",
          label: s.signed_at ? `${title} ingevuld en ondertekend` : `${title} ingevuld`,
        });
      }
      for (const r of recs2 || []) {
        items.push({
          occurred_at: (r.completed_at ?? r.created_at) as string,
          category: "treatments",
          label: r.status === "completed" ? "Behandelverslag afgerond" : "Behandelverslag als concept opgeslagen",
        });
      }
      items.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
      blocks.push(...timelineBlocks(items.slice(0, 100)));
    }
  }

  const pdf = await renderPdf(meta, blocks);

  // Photos are opt-in. With photos we ship a ZIP so one PDF never becomes huge.
  if (!includePhotos || mediaIds.length === 0) {
    return { bytes: pdf, format: "pdf", photoCount: 0 };
  }

  const { data: media } = await admin
    .from("clinical_media")
    .select("id, storage_path, mime_type, category, created_at, customer_id, is_demo")
    .eq("user_id", ctx.tenantId)
    .eq("customer_id", customer.id)
    .in("id", mediaIds);

  const files: Record<string, Uint8Array> = { "dossier.pdf": pdf };
  let count = 0;
  const missing: string[] = [];
  for (const m of media || []) {
    if (Boolean(m.is_demo) !== ctx.isDemo) continue;
    const { data: file, error } = await admin.storage.from(CLINICAL_BUCKET).download(m.storage_path as string);
    if (error || !file) { missing.push(String(m.id)); continue; }
    const ext = String(m.mime_type).includes("png") ? "png" : String(m.mime_type).includes("webp") ? "webp" : "jpg";
    const stamp = nlDate(m.created_at as string).replace(/\s/g, "-");
    files[`fotos/${m.category}-${stamp}-${count + 1}.${ext}`] = new Uint8Array(await file.arrayBuffer());
    count += 1;
  }
  if (count === 0) {
    // Every selected photo was unreadable: still deliver the document itself.
    return { bytes: pdf, format: "pdf", photoCount: 0 };
  }
  if (missing.length > 0) {
    files["fotos/LEESMIJ.txt"] = new TextEncoder().encode(
      `${missing.length} geselecteerde foto(s) konden niet worden opgehaald en ontbreken in deze map.\n`,
    );
  }
  const zipped = zipSync(files, { level: 6 });
  return { bytes: zipped, format: "zip", photoCount: count };
}

// ------------------------------------------------------------------ download
async function handleDownload(ctx: Ctx, body: Record<string, unknown>) {
  if (!ctx.mayContent) return json({ error: "forbidden" }, 403);
  const id = String(body.export_id ?? "");
  const { data: row } = await admin
    .from("document_exports")
    .select("id, storage_path, status, expires_at, is_demo, document_ref, format, scope")
    .eq("id", id)
    .eq("user_id", ctx.tenantId)
    .maybeSingle();
  if (!row || row.status !== "ready" || !row.storage_path) return json({ error: "not_found" }, 404);
  if (Boolean(row.is_demo) !== ctx.isDemo) return json({ error: "not_found" }, 404);
  if (new Date(row.expires_at).getTime() < Date.now()) return json({ error: "expired" }, 410);

  const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUrl(row.storage_path, DOWNLOAD_TTL, {
    download: `${safeName(row.document_ref)}.${row.format}`,
  });
  if (error || !signed?.signedUrl) return json({ error: "sign_failed" }, 500);

  await admin.from("document_exports").update({
    download_count: (await currentCount(row.id)) + 1,
    last_downloaded_at: new Date().toISOString(),
  }).eq("id", row.id);

  await audit(ctx, "dossier_export_downloaded", row.id, { scope: row.scope, ttl_seconds: DOWNLOAD_TTL });
  return json({ ok: true, url: signed.signedUrl, expires_in: DOWNLOAD_TTL });
}

async function currentCount(id: string): Promise<number> {
  const { data } = await admin.from("document_exports").select("download_count").eq("id", id).maybeSingle();
  return Number(data?.download_count ?? 0);
}

// --------------------------------------------------------------------- share
async function handleShare(ctx: Ctx, body: Record<string, unknown>) {
  if (!ctx.mayShare) return json({ error: "forbidden" }, 403);
  const exportId = String(body.export_id ?? "");
  const days = Math.min(Math.max(Number(body.expires_days ?? 14) || 14, 1), 30);
  const maxDownloads = Math.min(Math.max(Number(body.max_downloads ?? 10) || 10, 1), 50);

  const { data: row } = await admin
    .from("document_exports")
    .select("id, customer_id, status, storage_path, expires_at, is_demo, document_ref")
    .eq("id", exportId)
    .eq("user_id", ctx.tenantId)
    .maybeSingle();
  if (!row || row.status !== "ready" || !row.storage_path) return json({ error: "not_found" }, 404);
  if (Boolean(row.is_demo) !== ctx.isDemo) return json({ error: "not_found" }, 404);

  // A share can never outlive the file it points at.
  const expiresAt = new Date(Math.min(Date.now() + days * 86400000, new Date(row.expires_at).getTime()));

  const token = generateFormToken();
  const token_hash = await hashToken(token);
  const { data: share, error } = await admin
    .from("document_shares")
    .insert({
      user_id: ctx.tenantId,
      is_demo: ctx.isDemo,
      export_id: row.id,
      customer_id: row.customer_id,
      token_hash,
      max_downloads: maxDownloads,
      created_by: ctx.actorId,
      expires_at: expiresAt.toISOString(),
    })
    .select("id, expires_at, max_downloads")
    .single();
  if (error || !share) return json({ error: "share_failed" }, 500);

  await audit(ctx, "dossier_document_shared", row.id, {
    share_id: share.id, expires_at: share.expires_at, max_downloads: maxDownloads,
  });

  // The raw token exists only in this response and in the link the salon sends.
  return json({ ok: true, share: { ...share, link: `${publicAppOrigin()}/document/${token}` } });
}

async function handleRevoke(ctx: Ctx, body: Record<string, unknown>) {
  if (!ctx.mayShare) return json({ error: "forbidden" }, 403);
  const shareId = String(body.share_id ?? "");
  const { data: share } = await admin
    .from("document_shares").select("id, export_id, status")
    .eq("id", shareId).eq("user_id", ctx.tenantId).maybeSingle();
  if (!share) return json({ error: "not_found" }, 404);
  if (share.status !== "revoked") {
    await admin.from("document_shares").update({
      status: "revoked", revoked_at: new Date().toISOString(), revoked_by: ctx.actorId,
    }).eq("id", share.id).eq("user_id", ctx.tenantId);
  }
  await audit(ctx, "dossier_share_revoked", String(share.export_id), { share_id: share.id });
  return json({ ok: true });
}

// ---------------------------------------------------------------------- list
async function handleList(ctx: Ctx, body: Record<string, unknown>) {
  if (!ctx.mayContent) return json({ error: "forbidden" }, 403);
  const customerId = String(body.customer_id ?? "");
  if (!customerId) return json({ error: "customer_required" }, 400);
  const { data: exports } = await admin
    .from("document_exports")
    .select("id, scope, format, status, document_ref, photo_count, file_bytes, created_at, expires_at, appointment_id")
    .eq("user_id", ctx.tenantId).eq("customer_id", customerId).eq("is_demo", ctx.isDemo)
    .eq("status", "ready").order("created_at", { ascending: false }).limit(20);
  const ids = (exports || []).map((e) => e.id);
  const { data: shares } = ids.length
    ? await admin.from("document_shares")
        .select("id, export_id, status, expires_at, download_count, max_downloads, first_viewed_at")
        .eq("user_id", ctx.tenantId).in("export_id", ids).order("created_at", { ascending: false })
    : { data: [] };
  return json({ ok: true, exports: exports || [], shares: shares || [] });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const ctx = await resolveContext(req);
    if (!ctx) return json({ error: "unauthorized" }, 401);

    if (action === "create") return await handleCreate(ctx, body);
    if (action === "download") return await handleDownload(ctx, body);
    if (action === "share") return await handleShare(ctx, body);
    if (action === "revoke") return await handleRevoke(ctx, body);
    if (action === "list") return await handleList(ctx, body);
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("dossier_export_error", (e as Error).message);
    return json({ error: "server_error" }, 500);
  }
});
