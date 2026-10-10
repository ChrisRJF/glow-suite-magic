import { isValidSchedule, type WeeklySchedule, type DayKey } from "@/lib/employeeSchedule";

const NL = ["ma", "di", "wo", "do", "vr", "za", "zo"];

export type ScheduleSummary =
  | { kind: "schedule"; lines: string[] }
  | { kind: "legacy"; days: number[] }
  | { kind: "invalid" };

/**
 * Read-only summary for the team card. Uses the same source as availability:
 * weekly_schedule when set, otherwise legacy working_days (with salon opening hours).
 * Days with identical times are grouped: "ma, wo, vr 09:00–16:00".
 */
export function summarizeSchedule(emp: { weekly_schedule?: unknown; working_days?: number[] | null }): ScheduleSummary {
  const ws = emp.weekly_schedule;
  if (ws === null || ws === undefined) {
    const days = Array.isArray(emp.working_days) && emp.working_days.length ? emp.working_days.map(Number) : [1, 2, 3, 4, 5];
    return { kind: "legacy", days };
  }
  if (!isValidSchedule(ws)) return { kind: "invalid" };
  const groups = new Map<string, number[]>();
  for (let d = 1; d <= 7; d++) {
    const w = (ws as WeeklySchedule)[String(d) as DayKey];
    if (!w) continue;
    const key = `${w.start}–${w.end}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const lines = [...groups.entries()].map(([t, ds]) => `${ds.map((d) => NL[d - 1]).join(", ")} ${t}`);
  return { kind: "schedule", lines };
}
