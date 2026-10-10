import { describe, it, expect } from "vitest";
import { withinSchedule, isValidSchedule } from "../../supabase/functions/_shared/inactive/employeeSchedule";

// Fictional employee: ma tot 16:00, di tot 14:00, wo tot 16:00.
const sched = { "1": { start: "09:00", end: "16:00" }, "2": { start: "09:00", end: "14:00" }, "3": { start: "09:00", end: "16:00" } };
// 2026-10-12 = maandag, 13 = dinsdag, 14 = woensdag, 15 = donderdag

describe("employee weekly schedule", () => {
  it("allows booking inside hours", () => expect(withinSchedule(sched, "2026-10-12", "15:00", 60)).toBe(true));
  it("rejects booking running past monday 16:00", () => expect(withinSchedule(sched, "2026-10-12", "15:30", 60)).toBe(false));
  it("rejects tuesday after 14:00", () => expect(withinSchedule(sched, "2026-10-13", "14:00", 30)).toBe(false));
  it("allows wednesday until 16:00", () => expect(withinSchedule(sched, "2026-10-14", "15:30", 30)).toBe(true));
  it("rejects a day without schedule", () => expect(withinSchedule(sched, "2026-10-15", "10:00", 30)).toBe(false));
  it("rejects overlap with a break", () => expect(withinSchedule(sched, "2026-10-12", "12:15", 30, [{ start: "12:30", end: "13:00" }])).toBe(false));
  it("keeps current behaviour when no schedule is set", () => expect(withinSchedule(null, "2026-10-12", "20:00", 30)).toBeNull());
  it("fails closed on invalid schedule", () => {
    expect(isValidSchedule({ "1": { start: "16:00", end: "09:00" } })).toBe(false);
    expect(withinSchedule({ "8": { start: "09:00", end: "16:00" } }, "2026-10-12", "10:00", 30)).toBe(false);
  });
});
