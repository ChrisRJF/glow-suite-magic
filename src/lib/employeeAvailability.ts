// Helpers for reasoning about employee availability:
// - multiple breaks per employee (legacy break_start/break_end stays supported)
// - status: werkzaam | ziek | vrij | vakantie | afwezig
// - per-employee exceptions (sick/vacation/unavailable/custom_hours/break)
// All pure functions. No DB calls here.

export type EmployeeStatus = "werkzaam" | "ziek" | "vrij" | "vakantie" | "afwezig";

export const STATUS_OPTIONS: { value: EmployeeStatus; label: string; tone: string }[] = [
  { value: "werkzaam", label: "Werkzaam", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  { value: "ziek", label: "Ziek", tone: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  { value: "vrij", label: "Vrij", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  { value: "vakantie", label: "Vakantie", tone: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  { value: "afwezig", label: "Afwezig", tone: "bg-muted text-muted-foreground" },
];

export interface EmployeeBreak {
  start: string; // HH:MM
  end: string;   // HH:MM
  label?: string;
  days?: number[]; // optional 1..7 (Mon..Sun); empty/undefined = all working days
}

export interface ExceptionRow {
  id: string;
  employee_id: string;
  type: "break" | "sick" | "absent" | "vacation" | "unavailable" | "custom_hours";
  label?: string | null;
  start_date: string; // YYYY-MM-DD
  end_date?: string | null;
  start_time?: string | null; // HH:MM:SS
  end_time?: string | null;
  days_of_week?: number[] | null;
  note?: string | null;
}

const toHHMM = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : null);

export function parseBreaks(raw: unknown, legacyStart?: string | null, legacyEnd?: string | null): EmployeeBreak[] {
  const list: EmployeeBreak[] = Array.isArray(raw)
    ? raw
        .filter((b: any) => b && b.start && b.end)
        .map((b: any) => ({
          start: String(b.start).slice(0, 5),
          end: String(b.end).slice(0, 5),
          label: b.label || undefined,
          days: Array.isArray(b.days) ? b.days.map((d: any) => Number(d)) : undefined,
        }))
    : [];
  if (list.length === 0 && legacyStart && legacyEnd) {
    list.push({ start: toHHMM(legacyStart)!, end: toHHMM(legacyEnd)!, label: "Pauze" });
  }
  return list;
}

export function dayOfWeekIso(date: Date): number {
  const d = date.getDay();
  return d === 0 ? 7 : d; // Mon=1..Sun=7
}

export function isBreakActiveOn(b: EmployeeBreak, dow: number): boolean {
  if (!b.days || b.days.length === 0) return true;
  return b.days.includes(dow);
}

export function isSlotInBreaks(slot: string, breaks: EmployeeBreak[], dow: number): EmployeeBreak | null {
  for (const b of breaks) {
    if (!isBreakActiveOn(b, dow)) continue;
    if (slot >= b.start && slot < b.end) return b;
  }
  return null;
}

/** Returns the employee's effective absence type for the date, or null if working. */
export function getAbsenceForDate(
  employee: { status?: string | null; status_from?: string | null; status_until?: string | null },
  exceptions: ExceptionRow[],
  date: string // YYYY-MM-DD
): { type: "ziek" | "vrij" | "vakantie" | "afwezig" | "unavailable" | "custom_hours"; label: string } | null {
  // Check status (current absence) — if no until, it's open-ended; if from set, only after.
  const status = (employee.status || "werkzaam") as EmployeeStatus;
  if (status !== "werkzaam") {
    const from = employee.status_from || null;
    const until = employee.status_until || null;
    const afterFrom = !from || date >= from;
    const beforeUntil = !until || date <= until;
    if (afterFrom && beforeUntil) {
      const label =
        status === "ziek" ? "Ziek" :
        status === "vakantie" ? "Vakantie" :
        status === "vrij" ? "Vrij" : "Afwezig";
      return { type: status, label };
    }
  }
  // Check exceptions overlapping date (full-day blocking types).
  for (const ex of exceptions) {
    if (ex.type === "break" || ex.type === "custom_hours") continue;
    const start = ex.start_date;
    const end = ex.end_date || ex.start_date;
    if (date < start || date > end) continue;
    if (ex.start_time || ex.end_time) continue; // partial-day handled per slot
    const label =
      ex.type === "sick" ? "Ziek" :
      ex.type === "vacation" ? "Vakantie" :
      ex.type === "absent" ? "Afwezig" : "Niet beschikbaar";
    return { type: ex.type === "sick" ? "ziek" : ex.type === "vacation" ? "vakantie" : ex.type === "absent" ? "afwezig" : "unavailable", label };
  }
  return null;
}

/** True when the slot (HH:MM) on date is blocked by a partial-day exception. */
export function isSlotBlockedByException(
  slot: string,
  exceptions: ExceptionRow[],
  date: string,
  dow: number
): ExceptionRow | null {
  for (const ex of exceptions) {
    const start = ex.start_date;
    const end = ex.end_date || ex.start_date;
    if (date < start || date > end) continue;
    if (ex.days_of_week && ex.days_of_week.length && !ex.days_of_week.includes(dow)) continue;
    if (!ex.start_time || !ex.end_time) continue;
    const s = toHHMM(ex.start_time)!;
    const e = toHHMM(ex.end_time)!;
    if (slot >= s && slot < e) return ex;
  }
  return null;
}

export function statusMeta(status?: string | null) {
  return STATUS_OPTIONS.find((o) => o.value === (status || "werkzaam")) || STATUS_OPTIONS[0];
}
