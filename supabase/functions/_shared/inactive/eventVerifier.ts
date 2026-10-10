// INACTIVE (round 8D). Verifies that the business event behind a service send really exists
// and belongs to the same salon, customer and appointment. A valid HMAC proves WHICH internal
// function called; it does not prove the event. Not imported by any entrypoint.
//
// Only existing columns are used (read from src/integrations/supabase/types.ts, read-only):
//   appointments    id, user_id, customer_id, status, appointment_date, start_time
//   automation_runs id, user_id, customer_id, appointment_id, status
//   rebook_actions  id, user_id, customer_id, appointment_id, reversed_at
//   form_requests   id, user_id, customer_id, appointment_id, status, completed_at, expires_at
// Later real queries (service_role, one row, by primary key; never by tenant from the body):
//   select id,user_id,customer_id,status,appointment_date,start_time from appointments where id=$1
//   select id,user_id,customer_id,appointment_id,status from automation_runs where id=$1
//   select id,user_id,customer_id,appointment_id,reversed_at from rebook_actions where id=$1
//   select id,user_id,customer_id,appointment_id,status,completed_at,expires_at from form_requests where id=$1
// The resolver converts appointment_date+start_time (salon local time, Europe/Amsterdam) to
// epoch ms. Any query error must THROW; "no row" must return null.

export type EventType = "appointment" | "automation_run" | "rebook_action" | "form_request";

export type EventRow =
  | { type: "appointment"; id: string; user_id: string; customer_id: string | null; status: string; starts_at_ms: number | null }
  | { type: "automation_run"; id: string; user_id: string; customer_id: string | null; appointment_id: string | null; status: string }
  | { type: "rebook_action"; id: string; user_id: string; customer_id: string | null; appointment_id: string | null; reversed_at: string | null }
  | { type: "form_request"; id: string; user_id: string; customer_id: string; appointment_id: string | null; status: string; completed_at: string | null; expires_at_ms: number };

export type EventResolver = (type: EventType, id: string) => Promise<EventRow | null>;

/** Proposed reminder moments. The current reminderEngine uses ONE "reminder" type for both
 *  (shared marker, see audit); callers must send ":24h" / ":2h" after their separate change. */
export const REMINDER_WINDOWS_MS: Record<string, [number, number]> = {
  "24h": [2 * 3600e3, 30 * 3600e3],  // start - now in (2h, 30h]
  "2h": [0, 4 * 3600e3],             // start - now in (0, 4h]
};
export const CANCELLED_APPOINTMENT = "geannuleerd"; // value written by _shared/cancelAppointment.ts

export interface EventCheckInput {
  type: EventType; id: string; slot: string | null; kind: string;
  tenantId: string; customerId: string; appointmentId: string | null; nowMs: number;
}
export type EventCheck = { ok: true } | { ok: false; status: 403 | 409 | 422 | 503; reason: string };

const str = (v: unknown) => typeof v === "string" && v.length > 0;
const nullableStr = (v: unknown) => v === null || str(v);

function wellFormed(r: unknown, type: EventType, id: string): r is EventRow {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  if (o.type !== type || o.id !== id || !str(o.user_id)) return false;
  switch (type) {
    case "appointment": return nullableStr(o.customer_id) && typeof o.status === "string"
      && (o.starts_at_ms === null || (typeof o.starts_at_ms === "number" && Number.isFinite(o.starts_at_ms)));
    case "automation_run": return nullableStr(o.customer_id) && nullableStr(o.appointment_id) && typeof o.status === "string";
    case "rebook_action": return nullableStr(o.customer_id) && nullableStr(o.appointment_id) && nullableStr(o.reversed_at);
    case "form_request": return str(o.customer_id) && nullableStr(o.appointment_id) && typeof o.status === "string"
      && nullableStr(o.completed_at) && typeof o.expires_at_ms === "number" && Number.isFinite(o.expires_at_ms);
  }
}

export async function verifyBusinessEvent(i: EventCheckInput, resolve: EventResolver): Promise<EventCheck> {
  let row: unknown;
  try { row = await resolve(i.type, i.id); } catch { return { ok: false, status: 503, reason: "event_lookup_failed" }; }
  if (row === null || row === undefined) return { ok: false, status: 403, reason: "event_not_found" };
  if (!wellFormed(row, i.type, i.id)) return { ok: false, status: 503, reason: "event_lookup_failed" };
  const e = row as EventRow;
  if (e.user_id !== i.tenantId) return { ok: false, status: 403, reason: "event_not_in_tenant" };
  if (e.customer_id !== i.customerId) return { ok: false, status: 403, reason: "event_customer_mismatch" };
  if (e.type !== "appointment" && i.appointmentId !== null && e.appointment_id !== i.appointmentId)
    return { ok: false, status: 403, reason: "event_appointment_mismatch" };

  switch (e.type) {
    case "appointment": {
      if (i.appointmentId !== e.id) return { ok: false, status: 403, reason: "event_appointment_mismatch" };
      if ((i.kind === "reminder" || i.kind === "confirmation") && e.status === CANCELLED_APPOINTMENT)
        return { ok: false, status: 409, reason: "event_cancelled" };
      if (i.kind === "reminder") {
        const w = i.slot ? REMINDER_WINDOWS_MS[i.slot] : undefined;
        if (!w) return { ok: false, status: 422, reason: "invalid_reminder_slot" };
        if (e.starts_at_ms === null) return { ok: false, status: 422, reason: "event_time_unknown" };
        const lead = e.starts_at_ms - i.nowMs;
        if (!(lead > w[0] && lead <= w[1])) return { ok: false, status: 409, reason: "reminder_outside_window" };
      }
      return { ok: true };
    }
    case "automation_run":
      if (e.status === "skipped") return { ok: false, status: 409, reason: "event_not_active" };
      return { ok: true };
    case "rebook_action":
      if (e.reversed_at !== null) return { ok: false, status: 409, reason: "event_not_active" };
      return { ok: true };
    case "form_request":
      if (e.completed_at !== null || e.status === "completed") return { ok: false, status: 409, reason: "event_not_active" };
      if (e.expires_at_ms <= i.nowMs) return { ok: false, status: 409, reason: "event_expired" };
      if (i.kind === "form_reminder" && i.slot !== "reminder") return { ok: false, status: 422, reason: "invalid_reminder_slot" };
      if (i.kind === "form_request" && i.slot !== null) return { ok: false, status: 422, reason: "invalid_reminder_slot" };
      return { ok: true };
  }
}

