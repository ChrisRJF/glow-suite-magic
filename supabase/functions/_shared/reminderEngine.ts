// Canonical reminder engine — the single source of truth for all appointment
// reminders (booking confirmation, pre-appointment reminder, no-show follow-up,
// review request). Both `whatsapp-reminder-scheduler` and `automation-scheduler`
// must funnel through these helpers so behaviour, dedup and retries stay
// consistent across channels.
//
// Design rules:
//   1. One idempotency key per (appointment, reminder_type) — not per channel.
//   2. Channel selection is deterministic: WhatsApp preferred if opt-in + phone,
//      Email fallback if the salon has email enabled + address, otherwise skip
//      and log the reason.
//   3. Confirmation link is embedded automatically when the appointment has a
//      booking_token AND the reminder type supports Ja/Nee response.
//   4. Retry policy: 1 / 5 / 15 minutes, then dead-letter with merchant alert.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export type ReminderType =
  | "booking_confirmation"
  | "reminder"
  | "no_show"
  | "review"
  | "revenue_boost";

export type ReminderChannel = "whatsapp" | "email";

export const RETRY_BACKOFF_MIN = [1, 5, 15] as const;
export const MAX_ATTEMPTS = RETRY_BACKOFF_MIN.length;

export function publicAppOrigin(): string {
  return Deno.env.get("APP_PUBLIC_URL") || "https://glowsuite.nl";
}

export function buildConfirmationLink(bookingToken: string | null | undefined): string | null {
  if (!bookingToken) return null;
  return `${publicAppOrigin()}/afspraak/${bookingToken}`;
}

/**
 * Reminder types that carry an explicit "Ik kom / Ik kan niet"-response.
 * Others (review, revenue_boost) don't need a confirmation link.
 */
export function supportsConfirmation(t: ReminderType): boolean {
  return t === "booking_confirmation" || t === "reminder";
}

export function reminderIdempotencyKey(appointmentId: string, type: ReminderType): string {
  return `reminder:${type}:${appointmentId}`;
}

export interface ChannelSelection {
  channel: ReminderChannel | null;
  reason: string;
}

export function selectChannel(input: {
  customer: { phone?: string | null; email?: string | null; whatsapp_opt_in?: boolean | null } | null | undefined;
  waEnabled: boolean;
  emailEnabled: boolean;
}): ChannelSelection {
  const c = input.customer || {};
  const waOk = input.waEnabled && !!c.phone && c.whatsapp_opt_in !== false;
  const emailOk = input.emailEnabled && !!c.email;
  if (waOk) return { channel: "whatsapp", reason: "whatsapp_preferred" };
  if (emailOk) return { channel: "email", reason: "email_fallback" };
  if (!c.phone && !c.email) return { channel: null, reason: "no_contact_details" };
  if (!input.waEnabled && !input.emailEnabled) return { channel: null, reason: "no_channel_enabled" };
  if (c.whatsapp_opt_in === false && !emailOk) return { channel: null, reason: "customer_opted_out" };
  return { channel: null, reason: "no_deliverable_channel" };
}

/**
 * Cross-scheduler duplicate check. Returns true if a reminder of this type has
 * already been sent for this appointment through EITHER the WhatsApp scheduler
 * (`whatsapp_logs.reminder_type`) OR the automation scheduler
 * (`automation_runs.idempotency_key`).
 */
export async function reminderAlreadySent(
  admin: SupabaseClient,
  appointmentId: string,
  type: ReminderType,
): Promise<boolean> {
  const key = reminderIdempotencyKey(appointmentId, type);

  const { data: wa } = await admin
    .from("whatsapp_logs")
    .select("id")
    .eq("appointment_id", appointmentId)
    .eq("reminder_type", type)
    .in("status", ["sent", "demo"])
    .limit(1)
    .maybeSingle();
  if (wa) return true;

  const { data: run } = await admin
    .from("automation_runs")
    .select("id")
    .eq("appointment_id", appointmentId)
    .eq("idempotency_key", key)
    .in("status", ["sent", "scheduled", "retry"])
    .limit(1)
    .maybeSingle();
  return !!run;
}

/**
 * Append the confirmation call-to-action to a rendered reminder body if the
 * reminder type supports Ja/Nee and a booking token exists. Keeps copy short
 * and in the customer's language.
 */
export function appendConfirmationBlock(
  body: string,
  link: string | null,
  type: ReminderType,
  lang: string = "nl",
): string {
  if (!link || !supportsConfirmation(type)) return body;
  // Skip if the template author already inserted the link/token manually.
  if (body.includes(link)) return body;

  const lines: Record<string, { intro: string; yes: string; no: string }> = {
    nl: { intro: "Laat je ons weten of je komt?", yes: "✅ Ja, ik kom", no: "❌ Nee, ik kan niet" },
    en: { intro: "Can you let us know if you'll make it?", yes: "✅ Yes, I'll be there", no: "❌ No, I can't come" },
    de: { intro: "Kannst du uns Bescheid geben, ob du kommst?", yes: "✅ Ja, ich komme", no: "❌ Nein, ich kann nicht" },
    fr: { intro: "Peux-tu confirmer ta présence ?", yes: "✅ Oui, je viens", no: "❌ Non, je ne peux pas" },
    es: { intro: "¿Puedes confirmarnos si vienes?", yes: "✅ Sí, allí estaré", no: "❌ No, no puedo" },
  };
  const l = lines[lang] || lines.nl;
  return `${body.trimEnd()}\n\n${l.intro}\n${l.yes}: ${link}?a=confirm\n${l.no}: ${link}?a=decline`;
}

export interface RetryOutcome {
  status: "retry_scheduled" | "dead_letter";
  attempt: number;
  next_retry_at?: string;
}

/**
 * Records a failed WhatsApp send and schedules the next retry, OR moves the
 * row to dead-letter and notifies the salon owner when max attempts are hit.
 */
export async function recordFailureAndMaybeRetry(
  admin: SupabaseClient,
  logRow: { id: string; user_id: string; retry_count: number; appointment_id: string | null; reminder_type: string | null },
  errorMessage: string,
): Promise<RetryOutcome> {
  const nextAttempt = (logRow.retry_count || 0) + 1;
  const backoffIdx = nextAttempt - 1;
  const backoffMin = RETRY_BACKOFF_MIN[backoffIdx];
  const now = new Date();

  if (backoffMin === undefined) {
    // Exhausted retries → dead-letter
    await admin.from("whatsapp_logs").update({
      dead_letter: true,
      retry_count: nextAttempt,
      error: errorMessage.slice(0, 500),
      next_retry_at: null,
    }).eq("id", logRow.id);

    try {
      await admin.from("admin_notifications").insert({
        user_id: logRow.user_id,
        type: "reminder_delivery_failed",
        severity: "warning",
        title: "Een herinnering kon niet worden verstuurd",
        body: "We hebben het meerdere keren geprobeerd, maar de herinnering is niet aangekomen. Controleer het telefoonnummer van de klant.",
        link: logRow.appointment_id ? `/agenda` : "/whatsapp",
        payload: {
          whatsapp_log_id: logRow.id,
          appointment_id: logRow.appointment_id,
          reminder_type: logRow.reminder_type,
          attempts: nextAttempt,
        },
      });
    } catch (_) { /* non-fatal */ }

    return { status: "dead_letter", attempt: nextAttempt };
  }

  const nextAt = new Date(now.getTime() + backoffMin * 60 * 1000).toISOString();
  await admin.from("whatsapp_logs").update({
    retry_count: nextAttempt,
    next_retry_at: nextAt,
    error: errorMessage.slice(0, 500),
    status: "failed",
  }).eq("id", logRow.id);
  return { status: "retry_scheduled", attempt: nextAttempt, next_retry_at: nextAt };
}
