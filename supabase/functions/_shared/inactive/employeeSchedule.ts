// Shared availability rules for the internal calendar and public booking.
// Pure TypeScript, no imports: usable from Vite (re-exported by src/lib/employeeSchedule.ts)
// and from Deno edge functions. Not imported by any edge entrypoint until activation.
//
// Rule order for one employee on one date:
//   1. inactive employee or full-day absence (status / sick / vacation / absent / unavailable) -> not available
//   2. working window: weekly_schedule day (if a schedule is set) else legacy working_days + opening hours;
//      a "custom_hours" exception for that date replaces the window
//   3. window is intersected with the salon opening hours (closed salon day = not available)
//   4. breaks and partial-day exceptions block time inside the window
//   5. existing appointments block their full duration (no double booking)
// A NULL weekly_schedule keeps the legacy behaviour. An invalid schedule fails closed.

export type DayKey = "1" | "2" | "3" | "4" | "5" | "6" | "7";
export type DaySchedule = { start: string; end: string };
export type WeeklySchedule = Partial<Record<DayKey, DaySchedule>>;
export type Break = { start: string; end: string; days?: number[] };
export type OpeningHours = Record<string, { open?: string; close?: string; enabled?: boolean }>;

export interface ScheduleEmployee {
  id: string;
  is_active?: boolean | null;
  status?: string | null;
  status_from?: string | null;
  status_until?: string | null;
  working_days?: number[] | null;
  breaks?: unknown;
  break_start?: string | null;
  break_end?: string | null;
  weekly_schedule?: unknown;
  services?: unknown;
}

export interface ScheduleException {
  employee_id: string;
  type: string;
  start_date: string;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  days_of_week?: number[] | null;
}

/** Existing appointment, expressed in Amsterdam local minutes on the date being checked. */
export interface BusyBlock { employee_id: string | null; start: number; end: number }

export const TIME_ZONE = "Europe/Amsterdam";
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_NL = ["ma", "di", "wo", "do", "vr", "za", "zo"];

export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const hhmm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : "");

export function isValidSchedule(s: unknown): s is WeeklySchedule {
  if (s === null || typeof s !== "object" || Array.isArray(s)) return false;
  return Object.entries(s as Record<string, any>).every(([k, d]) =>
    /^[1-7]$/.test(k) && d && typeof d === "object" && HHMM.test(d.start) && HHMM.test(d.end) && toMin(d.start) < toMin(d.end));
}

/** Returns a Dutch error message for the first invalid day, or null when valid. */
export function scheduleError(s: WeeklySchedule): string | null {
  for (const [k, d] of Object.entries(s)) {
    if (!d || !HHMM.test(d.start) || !HHMM.test(d.end)) return `${DAY_NL[Number(k) - 1] ?? k}: vul een geldige begin- en eindtijd in`;
    if (toMin(d.start) >= toMin(d.end)) return `${DAY_NL[Number(k) - 1] ?? k}: de eindtijd moet later zijn dan de begintijd`;
  }
  return null;
}

/** ISO weekday (1=ma..7=zo) for a YYYY-MM-DD date, independent of server timezone. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

// ---------- Amsterdam local time <-> UTC (DST-correct) ----------

function tzOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
  return Math.round((asUtc - utcMs) / 60000);
}

/** Amsterdam wall-clock date + HH:MM -> UTC Date (handles CET/CEST). */
export function amsterdamToUtc(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, toMin(time) / 60 | 0, toMin(time) % 60);
  let off = tzOffsetMinutes(guess - 0);
  off = tzOffsetMinutes(guess - off * 60000);
  return new Date(guess - off * 60000);
}

/** UTC instant -> Amsterdam local { date: YYYY-MM-DD, minutes since midnight }. */
export function utcToAmsterdam(iso: string | Date): { date: string; minutes: number } {
  const ms = new Date(iso).getTime();
  const local = new Date(ms + tzOffsetMinutes(ms) * 60000);
  return { date: local.toISOString().slice(0, 10), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

// ---------- rules ----------

function parseBreaks(emp: ScheduleEmployee): Break[] {
  const list = Array.isArray(emp.breaks)
    ? (emp.breaks as any[]).filter((b) => b && HHMM.test(hhmm(b.start)) && HHMM.test(hhmm(b.end)))
        .map((b) => ({ start: hhmm(b.start), end: hhmm(b.end), days: Array.isArray(b.days) ? b.days.map(Number) : undefined }))
    : [];
  if (!list.length && emp.break_start && emp.break_end) list.push({ start: hhmm(emp.break_start), end: hhmm(emp.break_end), days: undefined });
  return list;
}

function exceptionCovers(ex: ScheduleException, date: string, dow: number) {
  const end = ex.end_date || ex.start_date;
  if (date < ex.start_date || date > end) return false;
  if (Array.isArray(ex.days_of_week) && ex.days_of_week.length && !ex.days_of_week.map(Number).includes(dow)) return false;
  return true;
}

export function isFullDayAbsent(emp: ScheduleEmployee, exceptions: ScheduleException[], date: string): boolean {
  if (emp.is_active === false) return true;
  const status = emp.status || "werkzaam";
  if (status !== "werkzaam") {
    const afterFrom = !emp.status_from || date >= emp.status_from;
    const beforeUntil = !emp.status_until || date <= emp.status_until;
    if (afterFrom && beforeUntil) return true;
  }
  const dow = isoWeekday(date);
  return exceptions.some((ex) => ex.employee_id === emp.id && ex.type !== "break" && ex.type !== "custom_hours"
    && !ex.start_time && !ex.end_time && exceptionCovers(ex, date, dow));
}

function openingWindow(opening: OpeningHours | null | undefined, dow: number): DaySchedule | null | "unknown" {
  if (!opening || typeof opening !== "object") return "unknown";
  const day = (opening as any)[DAY_NL[dow - 1]];
  if (!day) return "unknown";
  if (day.enabled === false) return null;
  const open = hhmm(day.open), close = hhmm(day.close);
  if (!HHMM.test(open) || !HHMM.test(close) || toMin(open) >= toMin(close)) return null;
  return { start: open, end: close };
}

/** The employee's working window on this date, or null when not working. */
export function workingWindow(emp: ScheduleEmployee, exceptions: ScheduleException[], date: string, opening?: OpeningHours | null): DaySchedule | null {
  if (isFullDayAbsent(emp, exceptions, date)) return null;
  const dow = isoWeekday(date);
  const open = openingWindow(opening, dow);
  if (open === null) return null;

  let win: DaySchedule | null;
  if (emp.weekly_schedule === null || emp.weekly_schedule === undefined) {
    const days = Array.isArray(emp.working_days) && emp.working_days.length ? emp.working_days.map(Number) : [1, 2, 3, 4, 5];
    if (!days.includes(dow)) return null;
    win = open === "unknown" ? { start: "09:00", end: "18:00" } : open;
  } else {
    if (!isValidSchedule(emp.weekly_schedule)) return null; // fail closed
    win = (emp.weekly_schedule as WeeklySchedule)[String(dow) as DayKey] ?? null;
    if (!win) return null;
  }

  const custom = exceptions.find((ex) => ex.employee_id === emp.id && ex.type === "custom_hours"
    && HHMM.test(hhmm(ex.start_time)) && HHMM.test(hhmm(ex.end_time)) && exceptionCovers(ex, date, dow));
  if (custom) win = { start: hhmm(custom.start_time), end: hhmm(custom.end_time) };

  if (open !== "unknown") {
    const s = Math.max(toMin(win.start), toMin(open.start)), e = Math.min(toMin(win.end), toMin(open.end));
    if (s >= e) return null;
    win = { start: fromMin(s), end: fromMin(e) };
  }
  return win;
}

/** Time ranges inside the day that are blocked by breaks or partial-day exceptions. */
export function blockedRanges(emp: ScheduleEmployee, exceptions: ScheduleException[], date: string): Array<[number, number]> {
  const dow = isoWeekday(date);
  const out: Array<[number, number]> = [];
  for (const b of parseBreaks(emp)) if (!b.days?.length || b.days.includes(dow)) out.push([toMin(b.start), toMin(b.end)]);
  for (const ex of exceptions) {
    if (ex.employee_id !== emp.id || ex.type === "custom_hours") continue;
    if (!HHMM.test(hhmm(ex.start_time)) || !HHMM.test(hhmm(ex.end_time))) continue;
    if (exceptionCovers(ex, date, dow)) out.push([toMin(hhmm(ex.start_time)), toMin(hhmm(ex.end_time))]);
  }
  return out;
}

export interface DayContext {
  date: string;
  opening?: OpeningHours | null;
  exceptions: ScheduleException[];
  busy: BusyBlock[];
  /** Earliest local minute that may be booked (e.g. "now" on today). */
  notBefore?: number;
}

/** True when emp can start a treatment of `duration` minutes at `start` (HH:MM) on ctx.date. */
export function canStart(emp: ScheduleEmployee, ctx: DayContext, start: string, duration: number): boolean {
  if (!HHMM.test(start) || !(duration > 0)) return false;
  const win = workingWindow(emp, ctx.exceptions, ctx.date, ctx.opening);
  if (!win) return false;
  const s = toMin(start), e = s + duration;
  if (ctx.notBefore !== undefined && s < ctx.notBefore) return false;
  if (s < toMin(win.start) || e > toMin(win.end)) return false;
  if (blockedRanges(emp, ctx.exceptions, ctx.date).some(([bs, be]) => s < be && e > bs)) return false;
  // Unassigned appointments block everyone (conservative, matches legacy behaviour).
  return !ctx.busy.some((b) => (b.employee_id === null || b.employee_id === emp.id) && s < b.end && e > b.start);
}

/** Employee may perform this service: empty list = all services; else matches service id or name. */
export function canDoService(emp: ScheduleEmployee, service: { id: string; name: string }): boolean {
  const list = Array.isArray(emp.services) ? (emp.services as unknown[]).map(String) : [];
  return list.length === 0 || list.includes(service.id) || list.includes(service.name);
}

export function startTimes(emp: ScheduleEmployee, ctx: DayContext, duration: number, step = 15): string[] {
  const win = workingWindow(emp, ctx.exceptions, ctx.date, ctx.opening);
  if (!win) return [];
  const out: string[] = [];
  for (let m = toMin(win.start); m + duration <= toMin(win.end); m += step) if (canStart(emp, ctx, fromMin(m), duration)) out.push(fromMin(m));
  return out;
}

/** Legacy convenience used by older tests. NULL schedule -> null (caller keeps current rules). */
export function withinSchedule(schedule: unknown, date: string, start: string, durationMinutes: number, breaks: Break[] = []): boolean | null {
  if (schedule === null || schedule === undefined) return null;
  if (!isValidSchedule(schedule)) return false;
  return canStart({ id: "x", weekly_schedule: schedule, breaks }, { date, exceptions: [], busy: [] }, start, durationMinutes);
}

export interface BookingRequestRow { service: { id: string; name: string; duration_minutes: number }; time: string; employee: string | null }
export type BookingResolution = { ok: true; rows: Array<BookingRequestRow & { employee: string }> } | { ok: false; reason: "unknown_employee" | "not_qualified" | "unavailable" };

/**
 * Server-side decision for one booking (incl. group). Employee ids from the request are only
 * accepted when they belong to `employees` (already scoped to the salon). Missing employee =
 * automatic choice. Every placed row blocks its time for the following rows (no double booking).
 */
export function resolveBooking(employees: ScheduleEmployee[], ctx: DayContext, rows: BookingRequestRow[]): BookingResolution {
  const busy = [...ctx.busy];
  const out: Array<BookingRequestRow & { employee: string }> = [];
  for (const row of rows) {
    const day = { ...ctx, busy };
    let chosen: ScheduleEmployee | undefined;
    if (row.employee) {
      chosen = employees.find((e) => e.id === row.employee);
      if (!chosen) return { ok: false, reason: "unknown_employee" };
      if (!canDoService(chosen, row.service)) return { ok: false, reason: "not_qualified" };
      if (!canStart(chosen, day, row.time, row.service.duration_minutes)) return { ok: false, reason: "unavailable" };
    } else {
      chosen = employees.find((e) => canDoService(e, row.service) && canStart(e, day, row.time, row.service.duration_minutes));
      if (!chosen) return { ok: false, reason: "unavailable" };
    }
    const s = toMin(row.time);
    busy.push({ employee_id: chosen.id, start: s, end: s + row.service.duration_minutes });
    out.push({ ...row, employee: chosen.id });
  }
  return { ok: true, rows: out };
}

/** Convert appointment rows (UTC appointment_date + duration or end_time) to busy blocks for `date`. */
export function busyFromAppointments(date: string, rows: Array<{ appointment_date: string; end_time?: string | null; duration_minutes?: number | null; employee_id: string | null; status?: string | null }>): BusyBlock[] {
  const out: BusyBlock[] = [];
  for (const r of rows) {
    if (r.status && ["geannuleerd", "cancelled"].includes(r.status)) continue;
    const local = utcToAmsterdam(r.appointment_date);
    if (local.date !== date) continue;
    let end = r.duration_minutes ? local.minutes + Number(r.duration_minutes) : (HHMM.test(hhmm(r.end_time)) ? toMin(hhmm(r.end_time)) : local.minutes + 30);
    if (end <= local.minutes) end = 24 * 60;
    out.push({ employee_id: r.employee_id || null, start: local.minutes, end });
  }
  return out;
}

/** Appointments whose employee_id is not a current employee of the salon (sample names like "Bas",
 *  deleted employees, NULL) become salon-wide blocks, so they can never be double-booked. */
export function normalizeBusyEmployees<T extends { employee_id: string | null }>(rows: T[], knownIds: Set<string>): T[] {
  return rows.map((r) => ({ ...r, employee_id: r.employee_id && knownIds.has(r.employee_id) ? r.employee_id : null }));
}
