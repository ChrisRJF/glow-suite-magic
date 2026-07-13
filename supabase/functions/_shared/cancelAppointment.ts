// Canonical cancellation service — single source of truth for cancelling an appointment.
// All cancellation paths (public confirmation, dashboard, agenda, receptionist, API)
// MUST go through this helper so behaviour, cleanup and side-effects stay consistent.
//
// Idempotent: uses a status-guarded UPDATE so a second call is a no-op.
// Race-safe: the guarded UPDATE also protects against concurrent cancellation vs.
// confirmation (only one transition to "geannuleerd" ever fires the side-effects).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export type CancelSource =
  | "public_confirmation"
  | "salon_dashboard"
  | "salon_agenda"
  | "reception"
  | "system"
  | "api";

export interface CancelInput {
  appointmentId: string;
  source: CancelSource;
  actorUserId?: string | null;
  bookingToken?: string | null;
  reason?: string | null;
}

export interface CancelResult {
  ok: boolean;
  alreadyCancelled?: boolean;
  notFound?: boolean;
  appointmentId?: string;
  side_effects?: {
    cancellation_count_incremented: boolean;
    sub_appointments_cancelled: number;
    automation_runs_cancelled: number;
    pending_payments_cancelled: number;
    admin_notified: boolean;
    audit_logged: boolean;
    waitlist_candidates: number;
  };
}

export async function cancelAppointmentCanonical(
  supabase: SupabaseClient,
  input: CancelInput,
): Promise<CancelResult> {
  const nowIso = new Date().toISOString();

  // 1) Load full appointment first (for context, cleanup, and idempotency check).
  const { data: appt, error: fetchErr } = await supabase
    .from("appointments")
    .select("id, user_id, customer_id, service_id, appointment_date, start_time, status, confirmation_status, payment_status, payment_required, deposit_amount, amount_paid, is_demo, booking_token")
    .eq("id", input.appointmentId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!appt) return { ok: false, notFound: true };

  // Security guard: when a booking token is supplied it MUST match this appointment.
  if (input.bookingToken && appt.booking_token && appt.booking_token !== input.bookingToken) {
    return { ok: false, notFound: true };
  }

  // 2) Atomic status transition. WHERE status != 'geannuleerd' guarantees at most
  //    one caller executes the side-effect block below.
  const { data: transitioned, error: updErr } = await supabase
    .from("appointments")
    .update({
      status: "geannuleerd",
      confirmation_status: input.source === "public_confirmation" ? "declined" : appt.confirmation_status,
      payment_status: appt.payment_status === "paid" ? appt.payment_status : "cancelled",
      updated_at: nowIso,
    })
    .eq("id", appt.id)
    .neq("status", "geannuleerd")
    .select("id")
    .maybeSingle();
  if (updErr) throw updErr;

  if (!transitioned) {
    return { ok: true, alreadyCancelled: true, appointmentId: appt.id };
  }

  const sideEffects = {
    cancellation_count_incremented: false,
    sub_appointments_cancelled: 0,
    automation_runs_cancelled: 0,
    pending_payments_cancelled: 0,
    admin_notified: false,
    audit_logged: false,
    waitlist_candidates: 0,
  };

  // 3) Customer history — increment cancellation_count exactly once (protected by
  //    the atomic transition above).
  if (appt.customer_id) {
    try {
      const { data: c } = await supabase
        .from("customers")
        .select("cancellation_count")
        .eq("id", appt.customer_id)
        .maybeSingle();
      const next = ((c as { cancellation_count?: number } | null)?.cancellation_count ?? 0) + 1;
      await supabase
        .from("customers")
        .update({ cancellation_count: next, updated_at: nowIso })
        .eq("id", appt.customer_id);
      sideEffects.cancellation_count_incremented = true;
    } catch (_) { /* non-fatal */ }
  }

  // 4) Cleanup linked records (sub_appointments). appointment_employees cascade
  //    with the parent via RLS/user-scope reads and can stay for reporting.
  try {
    const { data: subs } = await supabase
      .from("sub_appointments")
      .update({ status: "geannuleerd", updated_at: nowIso })
      .eq("parent_appointment_id", appt.id)
      .neq("status", "geannuleerd")
      .select("id");
    sideEffects.sub_appointments_cancelled = subs?.length ?? 0;
  } catch (_) { /* non-fatal */ }

  // 5) Stop pending automations / reminders scheduled for this appointment.
  try {
    const { data: runs } = await supabase
      .from("automation_runs")
      .update({ status: "cancelled", updated_at: nowIso, error_message: "appointment_cancelled" })
      .eq("appointment_id", appt.id)
      .in("status", ["pending", "scheduled", "queued", "retry"])
      .select("id");
    sideEffects.automation_runs_cancelled = runs?.length ?? 0;
  } catch (_) { /* non-fatal */ }

  // 5b) Dead-letter any WhatsApp reminder retries in-flight for this appointment
  //     so the canonical retry pass never sends a stale reminder after cancel.
  try {
    await supabase
      .from("whatsapp_logs")
      .update({ dead_letter: true, next_retry_at: null, error: "appointment_cancelled" })
      .eq("appointment_id", appt.id)
      .eq("status", "failed")
      .eq("dead_letter", false)
      .not("reminder_type", "is", null);
  } catch (_) { /* non-fatal */ }

  // 6) Cancel outstanding payment requests (never touch paid rows — refund policy
  //    is handled through the existing refund flow, not hardcoded here).
  try {
    const { data: pays } = await supabase
      .from("payments")
      .update({ status: "cancelled", updated_at: nowIso })
      .eq("appointment_id", appt.id)
      .in("status", ["pending", "open", "requested", "created"])
      .select("id");
    sideEffects.pending_payments_cancelled = pays?.length ?? 0;
  } catch (_) { /* non-fatal */ }

  // 7) Notify salon (single row = no dupes).
  try {
    await supabase.from("admin_notifications").insert({
      user_id: appt.user_id,
      type: "appointment_cancelled",
      severity: "info",
      title: "Klant heeft afspraak geannuleerd",
      body: input.source === "public_confirmation"
        ? "Een klant heeft via de bevestigingslink afgezegd."
        : "Een afspraak is geannuleerd.",
      link: `/agenda?date=${(appt.appointment_date || "").slice(0, 10)}`,
      payload: {
        appointment_id: appt.id,
        customer_id: appt.customer_id,
        service_id: appt.service_id,
        source: input.source,
        appointment_date: appt.appointment_date,
        start_time: appt.start_time,
        deposit_paid: (appt.amount_paid ?? 0) > 0,
      },
    });
    sideEffects.admin_notified = true;
  } catch (_) { /* non-fatal */ }

  // 8) Audit trail.
  try {
    await supabase.from("audit_logs").insert({
      user_id: appt.user_id,
      actor_user_id: input.actorUserId ?? null,
      action: "appointment_cancelled",
      target_type: "appointment",
      target_id: appt.id,
      is_demo: appt.is_demo,
      details: {
        source: input.source,
        booking_token: input.bookingToken ?? null,
        reason: input.reason ?? null,
        customer_id: appt.customer_id,
        appointment_date: appt.appointment_date,
        start_time: appt.start_time,
        deposit_amount: appt.deposit_amount,
        amount_paid: appt.amount_paid,
        payment_status_before: appt.payment_status,
      },
    });
    sideEffects.audit_logged = true;
  } catch (_) { /* non-fatal */ }

  // 9) Waitlist — reuse the existing waitlist flow: when there are matching
  //    candidates, drop an actionable notification so the salon can invite via
  //    the existing WachtlijstPage. We do NOT build a parallel invitation
  //    service; the surface already exists in the app.
  try {
    let q = supabase
      .from("waitlist_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", appt.user_id)
      .eq("status", "active");
    if (appt.service_id) q = q.eq("service_id", appt.service_id);
    const { count } = await q;
    sideEffects.waitlist_candidates = count ?? 0;
    if ((count ?? 0) > 0) {
      try {
        await supabase.from("admin_notifications").insert({
          user_id: appt.user_id,
          type: "waitlist_slot_available",
          severity: "info",
          title: "Wachtlijst kans",
          body: `Er is een plek vrijgekomen en ${count} klant(en) staan op de wachtlijst voor deze dienst.`,
          link: "/wachtlijst",
          payload: {
            appointment_id: appt.id,
            service_id: appt.service_id,
            appointment_date: appt.appointment_date,
            start_time: appt.start_time,
            candidates: count,
          },
        });
      } catch (_) { /* non-fatal */ }
    }
  } catch (_) { /* non-fatal */ }

  return { ok: true, appointmentId: appt.id, side_effects: sideEffects };
}
