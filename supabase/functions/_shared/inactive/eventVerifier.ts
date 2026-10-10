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

/** Reminder moments, derived from the existing schedulers (read-only):
 *  - whatsapp-reminder-scheduler: target = hours_before (default 24) +/- 15 min
 *  - automation-scheduler: appointment_reminder_24h / _2h at hours +/- 1 h
 *  The verifier accepts the widest existing tolerance (+/- 1 h) and nothing more, so the two
 *  windows never overlap and a mis-slotted or late scheduler run is refused.
 *  Product decision (documented): salons with a custom reminder_hours_before other than 24/2
 *  are refused (fail-closed) until an explicit extra slot is approved. */
export const REMINDER_WINDOWS_MS: Record<string, [number, number]> = {
  "24h": [23 * 3600e3, 25 * 3600e3], // start - now in (23h, 25h]
  "2h": [1 * 3600e3, 3 * 3600e3],    // start - now in (1h, 3h]
};

/** Salon wall-clock (Europe/Amsterdam by default) -> epoch ms, DST-correct.
 *  Returns null for malformed input or a non-existent local time (spring-forward gap). */
export function localToEpochMs(date: string, time: string, tz = "Europe/Amsterdam"): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), tm = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!dm || !tm) return null;
  const [y, mo, da, h, mi] = [+dm[1], +dm[2], +dm[3], +tm[1], +tm[2]];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, da, h, mi);
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const asWall = (ms: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  };
  // Try both possible offsets; on ambiguity (autumn fold) take the earlier instant.
  const cands = [-3, -2, -1, 0, 1, 2].map((o) => wall + o * 3600e3).filter((ms) => asWall(ms) === wall);
  return cands.length ? Math.min(...cands) : null;
}
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

