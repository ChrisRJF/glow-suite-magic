// Canonical single-appointment reminder sender.
//
// This is the ONE place where an appointment reminder is rendered and
// dispatched. Both the automatic scheduler pass (`whatsapp-reminder-scheduler`)
// and the manual "Test herinnering versturen" action call this function, so a
// test send is byte-for-byte the same production message, template, channel
// selection, logging and dedup behaviour as the automatic one.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  getDefaultMessageTemplate,
  normalizeMessageLang,
  renderMessage,
  intlLocale,
} from "./messageTranslations.ts";
import {
  appendConfirmationBlock,
  buildConfirmationLink,
  claimReminderDispatch,
  reminderAlreadySent,
  selectChannel,
  type ReminderChannel,
} from "./reminderEngine.ts";

export interface ReminderSendResult {
  status: "sent" | "skipped" | "failed";
  channel: ReminderChannel | null;
  /** Machine-readable reason for skipped/failed. */
  reason?: string;
  error?: string;
  /** Rendered body, only returned for test sends (never logged raw). */
  preview?: string;
}

export interface SendAppointmentReminderOptions {
  supabaseUrl: string;
  serviceKey: string;
  userId: string;
  appointmentId: string;
  timezone: string;
  reminderHoursBefore?: number;
  emailEnabled?: boolean;
  /**
   * Manual test send: skips the time window (caller decides), does not consume
   * the canonical reminder claim, and logs under `reminder_test` so a real
   * reminder can still go out later. Everything else is identical.
   */
  test?: boolean;
  meta?: Record<string, unknown>;
}

/** Minimum seconds between two manual test sends for the same appointment. */
const TEST_COOLDOWN_SECONDS = 60;

export async function sendAppointmentReminder(
  admin: SupabaseClient,
  opts: SendAppointmentReminderOptions,
): Promise<ReminderSendResult> {
  const {
    supabaseUrl,
    serviceKey,
    userId,
    appointmentId,
    timezone: tz,
    reminderHoursBefore = 24,
    emailEnabled = true,
    test = false,
    meta = {},
  } = opts;

  const reminderType = test ? "reminder_test" : "reminder";

  const { data: appt } = await admin
    .from("appointments")
    .select("id, user_id, customer_id, appointment_date, start_time, status, booking_token, confirmation_status, service_id")
    .eq("id", appointmentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!appt) return { status: "skipped", channel: null, reason: "appointment_not_found" };
  if (!appt.customer_id) return { status: "skipped", channel: null, reason: "no_customer" };
  if (appt.status === "geannuleerd" || appt.confirmation_status === "declined") {
    return { status: "skipped", channel: null, reason: "appointment_cancelled" };
  }

  // Double-click / spam guard for manual tests.
  if (test) {
    const since = new Date(Date.now() - TEST_COOLDOWN_SECONDS * 1000).toISOString();
    const { data: recent } = await admin
      .from("whatsapp_logs")
      .select("id")
      .eq("appointment_id", appointmentId)
      .eq("reminder_type", reminderType)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();
    if (recent) return { status: "skipped", channel: null, reason: "recently_sent" };
  } else if (await reminderAlreadySent(admin, appt.id, "reminder")) {
    return { status: "skipped", channel: null, reason: "already_sent" };
  }

  const { data: customer } = await admin
    .from("customers")
    .select("id, name, phone, email, whatsapp_opt_in, preferred_language")
    .eq("id", appt.customer_id)
    .maybeSingle();
  if (!customer) return { status: "skipped", channel: null, reason: "customer_not_found" };

  const chan = selectChannel({ customer, waEnabled: true, emailEnabled });
  if (!chan.channel) return { status: "skipped", channel: null, reason: chan.reason };

  // Cross-channel canonical claim (automatic sends only).
  if (!test) {
    const claimed = await claimReminderDispatch(admin, appt.id, "reminder", chan.channel);
    if (!claimed) return { status: "skipped", channel: chan.channel, reason: "already_claimed" };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("salon_name")
    .eq("user_id", userId)
    .maybeSingle();
  const salonName = profile?.salon_name || "ons salon";

  const lang = normalizeMessageLang((customer as any).preferred_language || "nl");
  const startTime = (appt.start_time as string | null) || String(appt.appointment_date).substring(11, 16);
  const timeStr = String(startTime).substring(0, 5);
  const apptInstant = new Date(appt.appointment_date);
  const dateStr = new Intl.DateTimeFormat(intlLocale(lang), {
    timeZone: tz,
    day: "numeric",
    month: "long",
  }).format(apptInstant);

  const { data: service } = appt.service_id
    ? await admin.from("services").select("name").eq("id", appt.service_id).maybeSingle()
    : { data: null };
  const serviceName = (service as any)?.name || "";

  const { data: tpl } = await admin
    .from("whatsapp_templates")
    .select("content, is_active")
    .eq("user_id", userId)
    .eq("template_type", "reminder")
    .maybeSingle();

  const templateContent = (tpl?.is_active === false ? null : tpl?.content)
    || getDefaultMessageTemplate("booking_reminder", lang, "whatsapp");

  const confirmationLink = buildConfirmationLink(appt.booking_token as string | null);

  let message = renderMessage(templateContent, {
    customer_name: customer.name || "",
    salon_name: salonName,
    appointment_date: dateStr,
    appointment_time: timeStr,
    services: serviceName,
    reschedule_link: confirmationLink || "",
    review_link: "",
  });
  message = appendConfirmationBlock(message, confirmationLink, "reminder", lang);

  const baseMeta = { ...meta, tz, canonical_key: `reminder:${reminderType}:${appt.id}` };

  if (chan.channel === "whatsapp") {
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          user_id: userId,
          to: customer.phone,
          message,
          customer_id: customer.id,
          appointment_id: appt.id,
          kind: "reminder",
          reminder_type: reminderType,
          booking_token: appt.booking_token,
          confirmation_link: confirmationLink,
          meta: baseMeta,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && (data.success || data.deduped)) {
        return { status: "sent", channel: "whatsapp", preview: test ? message : undefined };
      }
      return { status: "failed", channel: "whatsapp", error: data?.error || `http_${resp.status}` };
    } catch (e) {
      return { status: "failed", channel: "whatsapp", error: e instanceof Error ? e.message : "unknown" };
    }
  }

  // Email fallback — identical Ja/Nee CTAs.
  try {
    const salonSlug = (salonName || "salon")
      .toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "salon";
    const invokeRes = await admin.functions.invoke("send-white-label-email", {
      body: {
        user_id: userId,
        salon_name: salonName,
        salon_slug: salonSlug,
        recipient_email: customer.email,
        recipient_name: customer.name || "",
        template_key: "appointment_reminder",
        idempotency_key: test
          ? `reminder-test-${appt.id}-${Date.now()}`
          : `reminder-${appt.id}-email`,
        language: lang,
        template_data: {
          customer_name: customer.name || "",
          salon_name: salonName,
          appointment_date: appt.appointment_date,
          date: appt.appointment_date,
          time: timeStr,
          start_time: timeStr,
          service_name: serviceName,
          manage_url: confirmationLink || undefined,
          confirm_url: confirmationLink ? `${confirmationLink}?a=confirm` : undefined,
          decline_url: confirmationLink ? `${confirmationLink}?a=decline` : undefined,
          reminder_hours_before: reminderHoursBefore,
        },
      },
    });
    if (invokeRes.error) throw new Error(invokeRes.error.message || "email_invoke_failed");

    try {
      await admin.from("whatsapp_logs").insert({
        user_id: userId,
        customer_id: customer.id,
        appointment_id: appt.id,
        to_number: `email:${customer.email}`,
        message: `[email] ${message.slice(0, 480)}`,
        status: "sent",
        kind: "reminder",
        reminder_type: reminderType,
        booking_token: appt.booking_token,
        confirmation_link: confirmationLink,
        meta: { ...baseMeta, channel: "email", fallback_reason: chan.reason },
      });
    } catch (_) { /* non-fatal audit */ }

    return { status: "sent", channel: "email", preview: test ? message : undefined };
  } catch (e) {
    if (!test) {
      await admin.from("reminder_dispatch_claims")
        .delete()
        .eq("appointment_id", appt.id)
        .eq("reminder_type", "reminder");
    }
    return { status: "failed", channel: "email", error: e instanceof Error ? e.message : "unknown" };
  }
}
