// Klantdossier P1 — proactive form automation.
//
// Reuses the existing pieces instead of building a second engine:
// - required forms are decided by the database function
//   `determine_required_forms_for_appointment`
// - delivery goes through the existing `whatsapp-send` function
// - the scheduler that already runs every few minutes drives this pass
//
// Everything here is idempotent. Running the pass twice never sends twice.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { generateFormToken, hashToken } from "./formCanonical.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function publicFormOrigin(): string {
  return Deno.env.get("APP_PUBLIC_URL") || "https://glowsuite.nl";
}

export interface RequiredForm {
  template_id: string;
  title: string;
  state: "valid" | "missing" | "expired" | "version_outdated" | "reissue_required";
  validity_mode: string;
  validity_months: number | null;
  auto_send: boolean;
  reminder_hours: number;
  valid_until: string | null;
  last_submitted_at: string | null;
  open_request_id: string | null;
}

export interface RequiredFormsPayload {
  ok: boolean;
  error?: string;
  appointment_id?: string;
  user_id?: string;
  customer_id?: string;
  is_demo?: boolean;
  appointment_date?: string;
  status?: string;
  required?: RequiredForm[];
}

export async function requiredFormsForAppointment(
  admin: SupabaseClient,
  appointmentId: string,
): Promise<RequiredFormsPayload> {
  const { data, error } = await admin.rpc("determine_required_forms_for_appointment", {
    _appointment_id: appointmentId,
  });
  if (error) return { ok: false, error: error.message };
  return (data as RequiredFormsPayload) ?? { ok: false, error: "no_payload" };
}

const DEAD_STATUSES = [
  "geannuleerd",
  "cancelled",
  "canceled",
  "no_show",
  "no-show",
  "noshow",
  "niet_verschenen",
  "declined",
];

/**
 * Creates (or reuses) a form request and sends the link over the existing
 * WhatsApp sender. Returns the request id and whether a message went out.
 */
export async function ensureFormRequest(input: {
  admin: SupabaseClient;
  tenantId: string;
  isDemo: boolean;
  customerId: string;
  templateId: string;
  appointmentId: string | null;
  trigger: "auto_booking" | "reminder";
}): Promise<{ requestId: string | null; sent: boolean; reused: boolean; error?: string }> {
  const { admin, tenantId, customerId, templateId, appointmentId } = input;

  const [{ data: customer }, { data: template }] = await Promise.all([
    admin.from("customers").select("id, name, phone").eq("id", customerId).eq("user_id", tenantId).maybeSingle(),
    admin.from("form_templates").select("id, title, current_version, is_active").eq("id", templateId).eq("user_id", tenantId).maybeSingle(),
  ]);
  if (!customer) return { requestId: null, sent: false, reused: false, error: "customer_not_found" };
  if (!template?.is_active || !template.current_version) {
    return { requestId: null, sent: false, reused: false, error: "template_not_published" };
  }

  const { data: version } = await admin
    .from("form_template_versions")
    .select("id, version, title")
    .eq("template_id", templateId)
    .eq("user_id", tenantId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!version) return { requestId: null, sent: false, reused: false, error: "version_not_found" };

  // Idempotency: an open, unexpired request for this appointment is reused.
  const base = admin
    .from("form_requests")
    .select("id, status, sent_at")
    .eq("user_id", tenantId)
    .eq("customer_id", customerId)
    .eq("template_id", templateId)
    .in("status", ["draft", "sent", "opened"])
    .gt("expires_at", new Date().toISOString());
  const { data: open } = appointmentId ? await base.eq("appointment_id", appointmentId) : await base.is("appointment_id", null);
  if (open && open.length > 0) {
    return { requestId: open[0].id, sent: false, reused: true };
  }

  const token = generateFormToken();
  const token_hash = await hashToken(token);

  const { data: request, error: insertError } = await admin
    .from("form_requests")
    .insert({
      user_id: tenantId,
      is_demo: input.isDemo,
      customer_id: customerId,
      appointment_id: appointmentId,
      template_id: templateId,
      template_version_id: version.id,
      token_hash,
      status: "sent",
      channel: "whatsapp",
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertError || !request) {
    return { requestId: null, sent: false, reused: false, error: insertError?.message || "insert_failed" };
  }

  const sent = await deliverFormMessage({
    admin,
    tenantId,
    customerId,
    appointmentId,
    phone: customer.phone as string | null,
    customerName: String(customer.name || ""),
    formTitle: String(version.title || template.title),
    token,
    requestId: request.id,
    kind: "form_request",
  });

  await admin.from("audit_logs").insert({
    user_id: tenantId,
    action: "form_request_sent",
    target_type: "form_request",
    target_id: request.id,
    details: { template_id: templateId, version: version.version, channel: "whatsapp", trigger: input.trigger },
  }).then(() => {}, () => {});

  return { requestId: request.id, sent, reused: false };
}

async function deliverFormMessage(input: {
  admin: SupabaseClient;
  tenantId: string;
  customerId: string;
  appointmentId: string | null;
  phone: string | null;
  customerName: string;
  formTitle: string;
  token: string;
  requestId: string;
  kind: "form_request" | "form_reminder";
}): Promise<boolean> {
  if (!input.phone) return false;

  const { data: settings } = await input.admin
    .from("settings")
    .select("salon_name")
    .eq("user_id", input.tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const salonName = settings?.salon_name || "je salon";
  const first = input.customerName.split(" ")[0] || "hallo";
  const link = `${publicFormOrigin()}/formulier/${input.token}`;

  const message = input.kind === "form_reminder"
    ? `Hoi ${first}, je afspraak bij ${salonName} komt eraan. Het formulier "${input.formTitle}" staat nog open.\n\nVul het hier in: ${link}\n\nHet duurt ongeveer 2 minuten.`
    : `Hoi ${first}, ${salonName} vraagt je om het formulier "${input.formTitle}" in te vullen voor je afspraak.\n\nVul het hier in: ${link}\n\nHet duurt ongeveer 2 minuten.`;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({
      user_id: input.tenantId,
      to: input.phone,
      message,
      customer_id: input.customerId,
      appointment_id: input.appointmentId,
      kind: input.kind,
      meta: { form_request_id: input.requestId },
    }),
  });
  const payload = await res.json().catch(() => ({}));
  return res.ok && payload?.success !== false;
}

/** Re-send the link of an existing open request (reminder path). */
async function remindOpenRequest(
  admin: SupabaseClient,
  requestId: string,
): Promise<boolean> {
  const { data: request } = await admin
    .from("form_requests")
    .select("id, user_id, customer_id, appointment_id, template_id, template_version_id, status, reminder_sent_at, expires_at")
    .eq("id", requestId)
    .maybeSingle();
  if (!request || request.status === "completed" || request.status === "cancelled") return false;
  if (new Date(String(request.expires_at)).getTime() < Date.now()) return false;
  if (request.reminder_sent_at) return false; // exactly one reminder per request

  // The raw token is not stored; issue a fresh token for the same request so the
  // customer keeps one single open form instead of a second one.
  const token = generateFormToken();
  const token_hash = await hashToken(token);
  const { error: rotateError } = await admin
    .from("form_requests")
    .update({ token_hash, reminder_sent_at: new Date().toISOString() })
    .eq("id", request.id)
    .is("reminder_sent_at", null);
  if (rotateError) return false;

  const [{ data: customer }, { data: version }] = await Promise.all([
    admin.from("customers").select("name, phone").eq("id", request.customer_id).maybeSingle(),
    admin.from("form_template_versions").select("title").eq("id", request.template_version_id).maybeSingle(),
  ]);

  return await deliverFormMessage({
    admin,
    tenantId: String(request.user_id),
    customerId: String(request.customer_id),
    appointmentId: request.appointment_id ? String(request.appointment_id) : null,
    phone: (customer?.phone as string | null) ?? null,
    customerName: String(customer?.name || ""),
    formTitle: String(version?.title || "Formulier"),
    token,
    requestId: request.id,
    kind: "form_reminder",
  });
}

export interface DossierPassStats {
  queue_processed: number;
  auto_sent: number;
  reminders_sent: number;
  skipped: number;
  errors: string[];
}

/**
 * One pass of the dossier automation:
 * 1. drain the booking queue (auto send missing forms)
 * 2. remind customers with an open form shortly before their appointment
 */
export async function runDossierFormPass(admin: SupabaseClient, now = new Date()): Promise<DossierPassStats> {
  const stats: DossierPassStats = { queue_processed: 0, auto_sent: 0, reminders_sent: 0, skipped: 0, errors: [] };

  // ---------------------------------------------------------------- 1. queue
  const { data: queued } = await admin
    .from("dossier_automation_queue")
    .select("id, appointment_id, attempts")
    .is("processed_at", null)
    .lt("attempts", 3)
    .order("created_at", { ascending: true })
    .limit(100);

  for (const row of queued || []) {
    stats.queue_processed++;
    try {
      const payload = await requiredFormsForAppointment(admin, String(row.appointment_id));
      if (!payload.ok) {
        await admin.from("dossier_automation_queue")
          .update({ attempts: (row.attempts as number) + 1, last_error: payload.error ?? "unknown" })
          .eq("id", row.id);
        continue;
      }
      const dead = DEAD_STATUSES.includes(String(payload.status || ""));
      const past = payload.appointment_date ? new Date(payload.appointment_date).getTime() < now.getTime() : false;
      if (!dead && !past && payload.customer_id) {
        for (const form of payload.required || []) {
          if (form.state === "valid" || !form.auto_send) {
            stats.skipped++;
            continue;
          }
          const result = await ensureFormRequest({
            admin,
            tenantId: String(payload.user_id),
            isDemo: Boolean(payload.is_demo),
            customerId: String(payload.customer_id),
            templateId: form.template_id,
            appointmentId: String(row.appointment_id),
            trigger: "auto_booking",
          });
          if (result.reused) stats.skipped++;
          else if (result.requestId) stats.auto_sent++;
          else if (result.error) stats.errors.push(`auto_send:${result.error}`);
        }
      }
      await admin.from("dossier_automation_queue")
        .update({ processed_at: new Date().toISOString(), attempts: (row.attempts as number) + 1 })
        .eq("id", row.id);
    } catch (e) {
      stats.errors.push(`queue:${e instanceof Error ? e.message : "unknown"}`);
      await admin.from("dossier_automation_queue")
        .update({ attempts: (row.attempts as number) + 1, last_error: e instanceof Error ? e.message.slice(0, 200) : "unknown" })
        .eq("id", row.id);
    }
  }

  // ------------------------------------------------------------ 2. reminders
  const horizon = new Date(now.getTime() + 48 * 3600 * 1000).toISOString();
  const { data: openRequests } = await admin
    .from("form_requests")
    .select("id, user_id, appointment_id, template_id, reminder_sent_at, appointments!inner(id, appointment_date, status, service_id)")
    .in("status", ["sent", "opened"])
    .is("reminder_sent_at", null)
    .not("appointment_id", "is", null)
    .gt("appointments.appointment_date", now.toISOString())
    .lt("appointments.appointment_date", horizon)
    .limit(200);

  for (const row of openRequests || []) {
    const appt = (row as unknown as { appointments: { appointment_date: string; status: string; service_id: string } }).appointments;
    if (!appt) continue;
    if (DEAD_STATUSES.includes(String(appt.status || "").toLowerCase())) {
      stats.skipped++;
      continue;
    }
    const { data: requirement } = await admin
      .from("service_form_requirements")
      .select("reminder_hours")
      .eq("user_id", row.user_id)
      .eq("service_id", appt.service_id)
      .eq("template_id", row.template_id)
      .maybeSingle();
    const hours = requirement?.reminder_hours ?? 24;
    if (!hours) {
      stats.skipped++;
      continue;
    }
    const dueAt = new Date(appt.appointment_date).getTime() - hours * 3600 * 1000;
    if (now.getTime() < dueAt) {
      stats.skipped++;
      continue;
    }
    try {
      const ok = await remindOpenRequest(admin, String(row.id));
      if (ok) stats.reminders_sent++;
      else stats.skipped++;
    } catch (e) {
      stats.errors.push(`reminder:${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  return stats;
}
