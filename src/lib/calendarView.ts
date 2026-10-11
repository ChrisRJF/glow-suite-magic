// Display-only helpers for the agenda views. No writes, no reminders.

export type CalendarView = "day" | "columns" | "week";

/** Day and columns are both one-day views; only week moves 7 days. */
export const isSingleDayView = (v: CalendarView) => v !== "week";
export const navStepDays = (v: CalendarView) => (isSingleDayView(v) ? 1 : 7);

const amsParts = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).reduce<Record<string, string>>((a, p) => { a[p.type] = p.value; return a; }, {});

/**
 * Calendar day an appointment is shown on.
 * - New rows (real UTC, e.g. online booking): start_time equals the Amsterdam clock -> Amsterdam date.
 * - Old rows (wall clock stored as UTC) and anything unclear: the stored date as before (no guessing).
 */
export function appointmentDisplayDate(a: { appointment_date: string; start_time?: string | null }): string {
  const raw = String(a.appointment_date);
  const legacy = raw.slice(0, 10);
  const st = (a.start_time || "").slice(0, 5);
  if (!st) return legacy;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return legacy;
  if (d.toISOString().slice(11, 16) === st) return legacy; // old notation, keep as is
  const p = amsParts(d);
  if (`${p.hour}:${p.minute}` === st) return `${p.year}-${p.month}-${p.day}`;
  return legacy;
}
