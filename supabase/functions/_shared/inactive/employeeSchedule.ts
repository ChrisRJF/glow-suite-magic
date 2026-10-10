// INACTIVE: not imported by any entrypoint. Shared rule for internal calendar and
// public booking: is a booking for this employee inside their working hours?
export type DaySchedule = { start: string; end: string };
export type WeeklySchedule = Partial<Record<"1" | "2" | "3" | "4" | "5" | "6" | "7", DaySchedule>>;
export type Break = { start: string; end: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function isValidSchedule(s: unknown): s is WeeklySchedule {
  if (s === null || typeof s !== "object" || Array.isArray(s)) return false;
  return Object.entries(s as Record<string, any>).every(([k, d]) =>
    /^[1-7]$/.test(k) && d && HHMM.test(d.start) && HHMM.test(d.end) && toMin(d.start) < toMin(d.end));
}

/** ISO weekday (1=ma..7=zo) for a YYYY-MM-DD date, independent of server timezone. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * Server-side check. Fails closed on invalid input. A NULL schedule means
 * "no weekly schedule configured" and returns null so the caller keeps its current rules.
 */
export function withinSchedule(
  schedule: unknown, date: string, start: string, durationMinutes: number, breaks: Break[] = [],
): boolean | null {
  if (schedule === null || schedule === undefined) return null;
  if (!isValidSchedule(schedule) || !HHMM.test(start) || !(durationMinutes > 0)) return false;
  const day = schedule[String(isoWeekday(date)) as keyof WeeklySchedule];
  if (!day) return false;
  const s = toMin(start), e = s + durationMinutes;
  if (s < toMin(day.start) || e > toMin(day.end)) return false;
  return !breaks.some((b) => HHMM.test(b.start) && HHMM.test(b.end) && s < toMin(b.end) && e > toMin(b.start));
}
