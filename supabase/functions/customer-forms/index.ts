// Klantdossier P0a — customer form requests & public submissions.
//
// Authenticated actions (staff): send
// Public actions (token only):   get, submit
//
// Security rules:
// - The browser NEVER supplies a tenant id. It is resolved server-side from the
//   JWT (staff) or from the stored request row (public).
// - Public tokens are 256-bit CSPRNG values; only their SHA-256 hash is stored.
// - Every relation (customer/appointment/template) is re-validated server-side.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  buildCanonicalSnapshot,
  detectAlertLabels,
  documentHash,
  generateFormToken,
  hashToken,
  sanitizeText,
  validateAnswers,
  validateSignature,
  type FormSchema,
} from "../_shared/formCanonical.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function publicAppOrigin(): string {
  return Deno.env.get("APP_PUBLIC_URL") || "https://glowsuite.nl";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}

/** Privacy preserving: never store raw IP or user agent. */
async function auditFingerprint(req: Request): Promise<string> {
  const raw = `${clientIp(req)}|${req.headers.get("user-agent") || ""}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function rateLimit(bucket: string, max: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await admin.rpc("check_public_rate_limit", {
    _bucket: bucket,
    _max: max,
    _window_seconds: windowSeconds,
  });
  if (error) return true; // fail open on limiter outage, never block the customer
  return data !== false;
}

// ---------------------------------------------------------------- staff: send
async function handleSend(req: Request, body: Record<string, unknown>) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "unauthorized" }, 401);

  // Deterministic tenant + permission, both decided by the database.
  const { data: tenantId } = await userClient.rpc("current_tenant_id");
  const { data: maySend } = await userClient.rpc("can_send_customer_form");
  if (!tenantId) return json({ error: "tenant_unresolved" }, 403);
  if (maySend !== true) return json({ error: "forbidden" }, 403);

  const customerId = String(body.customer_id ?? "");
  const templateId = String(body.template_id ?? "");
  const appointmentId = body.appointment_id ? String(body.appointment_id) : null;
  const channel = body.channel === "email" ? "email" : "whatsapp";
  if (!customerId || !templateId) return json({ error: "customer_id_and_template_id_required" }, 400);

  // Re-validate every relation against the resolved tenant.
  const [{ data: customer }, { data: template }] = await Promise.all([
    admin.from("customers").select("id, name, phone, email, is_demo, archived_at, pseudonymized_at, communication_blocked_at").eq("id", customerId).eq("user_id", tenantId).maybeSingle(),
    admin.from("form_templates").select("id, title, kind, current_version, is_active, is_demo").eq("id", templateId).eq("user_id", tenantId).maybeSingle(),
  ]);
  if (!customer) return json({ error: "customer_not_found" }, 404);
  if (customer.archived_at || customer.pseudonymized_at || customer.communication_blocked_at) {
    return json({ error: "customer_communication_blocked" }, 409);
  }
  if (!template) return json({ error: "template_not_found" }, 404);
  if (!template.is_active || !template.current_version) return json({ error: "template_not_published" }, 400);

  if (appointmentId) {
    const { data: appt } = await admin.from("appointments").select("id, customer_id").eq("id", appointmentId).eq("user_id", tenantId).maybeSingle();
    if (!appt) return json({ error: "appointment_not_found" }, 404);
    if (appt.customer_id !== customerId) return json({ error: "appointment_customer_mismatch" }, 400);
  }

  // Always use the LATEST published version of this template.
  const { data: version } = await admin
    .from("form_template_versions")
    .select("id, version, schema, require_signature, title")
    .eq("template_id", templateId)
    .eq("user_id", tenantId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!version) return json({ error: "version_not_found" }, 404);

  // Idempotency: reuse an open request for the same customer/template/appointment.
  const existingQuery = admin
    .from("form_requests")
    .select("id, status, expires_at")
    .eq("user_id", tenantId)
    .eq("customer_id", customerId)
    .eq("template_id", templateId)
    .in("status", ["draft", "sent", "opened"])
    .gt("expires_at", new Date().toISOString());
  const { data: openRequests } = appointmentId
    ? await existingQuery.eq("appointment_id", appointmentId)
    : await existingQuery.is("appointment_id", null);

  if (openRequests && openRequests.length > 0) {
    return json({ ok: true, duplicate: true, request_id: openRequests[0].id, message: "Er staat al een openstaand formulier voor deze klant." });
  }

  const token = generateFormToken();
  const token_hash = await hashToken(token);

  const { data: request, error: insertError } = await admin
    .from("form_requests")
    .insert({
      user_id: tenantId,
      is_demo: Boolean(template.is_demo),
      customer_id: customerId,
      appointment_id: appointmentId,
      template_id: templateId,
      template_version_id: version.id,
      token_hash,
      status: "sent",
      channel,
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertError) {
    console.error("form_request_insert_failed", insertError.message);
    return json({ error: "request_create_failed" }, 500);
  }

  const link = `${publicAppOrigin()}/formulier/${token}`;

  // Reuse the existing central WhatsApp sender. No new messaging pipeline.
  let delivery: Record<string, unknown> = { attempted: false };
  if (channel === "whatsapp" && customer.phone) {
    const { data: settings } = await admin.from("settings").select("salon_name").eq("user_id", tenantId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const salonName = settings?.salon_name || "je salon";
    const first = String(customer.name || "").split(" ")[0] || "hallo";
    const message = `Hoi ${first}, ${salonName} vraagt je om het formulier "${version.title}" in te vullen voor je afspraak.\n\nVul het hier in: ${link}\n\nHet duurt ongeveer 2 minuten.`;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        user_id: tenantId,
        to: customer.phone,
        message,
        customer_id: customerId,
        appointment_id: appointmentId,
        kind: "form_request",
        meta: { form_request_id: request.id },
      }),
    });
    const payload = await res.json().catch(() => ({}));
    delivery = { attempted: true, channel: "whatsapp", ok: res.ok && payload?.success !== false, error: payload?.error ?? null };
  }

  await admin.from("audit_logs").insert({
    user_id: tenantId,
    actor_user_id: user.id,
    action: "form_request_sent",
    target_type: "form_request",
    target_id: request.id,
    details: { template_id: templateId, version: version.version, channel },
  }).then(() => {}, () => {});

  return json({ ok: true, request_id: request.id, link, delivery });
}

// -------------------------------------------------------------- public: get
async function loadByToken(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const token_hash = await hashToken(token);
  const { data: request } = await admin
    .from("form_requests")
    .select("id, user_id, customer_id, appointment_id, template_id, template_version_id, status, expires_at")
    .eq("token_hash", token_hash)
    .maybeSingle();
  return request ?? null;
}

async function handleGet(req: Request, token: string) {
  if (!(await rateLimit(`form_get_${clientIp(req)}`, 40, 300))) return json({ error: "rate_limited" }, 429);

  const request = await loadByToken(token);
  if (!request) return json({ error: "not_found" }, 404);
  if (new Date(request.expires_at).getTime() < Date.now()) return json({ error: "expired" }, 410);
  if (request.status === "cancelled") return json({ error: "cancelled" }, 410);

  const [{ data: version }, { data: settings }, { data: customer }] = await Promise.all([
    admin.from("form_template_versions").select("id, version, title, kind, require_signature, schema").eq("id", request.template_version_id).maybeSingle(),
    admin.from("settings").select("salon_name").eq("user_id", request.user_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("customers").select("name").eq("id", request.customer_id).maybeSingle(),
  ]);
  if (!version) return json({ error: "not_found" }, 404);

  if (request.status === "completed") {
    return json({ ok: true, completed: true, title: version.title, salon_name: settings?.salon_name || "" });
  }

  if (request.status === "sent") {
    await admin.from("form_requests").update({ status: "opened", opened_at: new Date().toISOString() }).eq("id", request.id);
  }

  return json({
    ok: true,
    completed: false,
    salon_name: settings?.salon_name || "",
    customer_name: customer?.name || "",
    title: version.title,
    kind: version.kind,
    require_signature: version.require_signature,
    schema: version.schema,
  });
}

// ------------------------------------------------------------ public: submit
async function handleSubmit(req: Request, token: string, body: Record<string, unknown>) {
  if (!(await rateLimit(`form_submit_${clientIp(req)}`, 15, 600))) return json({ error: "rate_limited" }, 429);

  const request = await loadByToken(token);
  if (!request) return json({ error: "not_found" }, 404);
  if (new Date(request.expires_at).getTime() < Date.now()) return json({ error: "expired" }, 410);
  if (request.status === "cancelled") return json({ error: "cancelled" }, 410);
  if (request.status === "completed") {
    // Idempotent submit: replaying the same token returns success, not a duplicate row.
    return json({ ok: true, already_submitted: true });
  }

  const { data: version } = await admin
    .from("form_template_versions")
    .select("id, version, title, kind, require_signature, schema")
    .eq("id", request.template_version_id)
    .maybeSingle();
  if (!version) return json({ error: "not_found" }, 404);

  const schema = version.schema as unknown as FormSchema;
  const answersResult = validateAnswers(schema, body.answers);
  if (!answersResult.ok) return json({ error: "validation_failed", detail: answersResult.error }, 400);

  const signatureResult = validateSignature(
    version.require_signature,
    body.signer_name,
    body.signature_data,
    body.consent,
  );
  if (!signatureResult.ok) return json({ error: "validation_failed", detail: signatureResult.error }, 400);

  const signatureMethod = version.require_signature
    ? signatureResult.signatureData
      ? ("drawn" as const)
      : ("typed" as const)
    : null;

  const snapshot = buildCanonicalSnapshot({
    templateId: request.template_id,
    templateVersionId: version.id,
    version: version.version,
    title: version.title,
    kind: version.kind,
    requireSignature: version.require_signature,
    answers: answersResult.answers,
    signerName: signatureResult.signerName,
    ...(version.require_signature
      ? { consent: signatureResult.consent, signatureMethod }
      : {}),
  });
  const hash = await documentHash(snapshot);

  const { data: submissionRow, error: submitError } = await admin.from("form_submissions").insert({
    user_id: request.user_id,
    is_demo: false,
    request_id: request.id,
    customer_id: request.customer_id,
    appointment_id: request.appointment_id,
    template_id: request.template_id,
    template_version_id: version.id,
    answers: answersResult.answers.map,
    rendered_snapshot: snapshot,
    document_hash: hash,
    signer_name: signatureResult.signerName,
    signed_at: signatureResult.consent ? new Date().toISOString() : null,
    signature_data: signatureResult.signatureData,
    audit_metadata: {
      fingerprint: await auditFingerprint(req),
      submitted_via: "public_link",
      explicit_consent: signatureResult.consent,
      signature_method: signatureMethod,
    },
  }).select("id").single();

  if (submitError) {
    if (submitError.code === "23505") return json({ ok: true, already_submitted: true });
    console.error("form_submission_insert_failed", submitError.message);
    return json({ error: "submit_failed" }, 500);
  }

  // P2b-1: a signed template that records marketing consent creates one append-only consent event.
  const { data: templateRow } = await admin
    .from("form_templates")
    .select("consent_scope")
    .eq("id", request.template_id)
    .maybeSingle();
  const consentScope = templateRow?.consent_scope as string | null | undefined;
  if (consentScope && signatureResult.consent) {
    await admin.from("customer_consents").insert({
      user_id: request.user_id,
      is_demo: false,
      customer_id: request.customer_id,
      consent_type: "marketing_media",
      scope: consentScope,
      event: "granted",
      source: "form",
      source_reference: request.id,
      version: version.version,
      proof_reference: submissionRow?.id ?? null,
    }).then(() => {}, () => {});
  }

  await admin.from("form_requests").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", request.id);

  // Attention points: administrative flags configured on the template.
  const alertLabels = detectAlertLabels(schema, answersResult.answers);
  if (alertLabels.length > 0) {
    await admin.from("customer_alerts").insert(
      alertLabels.map((label) => ({
        user_id: request.user_id,
        is_demo: false,
        customer_id: request.customer_id,
        source_type: "form_answer",
        source_id: request.id,
        label,
        review_status: "unreviewed",
      })),
    ).then(() => {}, () => {});
  }

  await admin.from("audit_logs").insert({
    user_id: request.user_id,
    action: "form_submitted",
    target_type: "form_request",
    target_id: request.id,
    details: { template_id: request.template_id, version: version.version, document_hash: hash, alerts: alertLabels.length },
  }).then(() => {}, () => {});

  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
    const url = new URL(req.url);
    const action = sanitizeText(String(body.action ?? url.searchParams.get("action") ?? ""), 20);
    const token = String(body.token ?? url.searchParams.get("token") ?? "");

    if (action === "send") return await handleSend(req, body);
    if (action === "get") return await handleGet(req, token);
    if (action === "submit") return await handleSubmit(req, token, body);
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("customer-forms error", (e as Error).message);
    return json({ error: "server_error" }, 500);
  }
});
