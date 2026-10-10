import { describe, it, expect } from "vitest";
import {
  withinSchedule, isValidSchedule, scheduleError, canStart, startTimes, workingWindow, resolveBooking,
  amsterdamToUtc, utcToAmsterdam, busyFromAppointments, canDoService, type ScheduleEmployee, type DayContext,
} from "../../supabase/functions/_shared/inactive/employeeSchedule";

// Fictional salon "Studio Fictief". 2026-10-12 = maandag, 13 = di, 14 = wo, 15 = do.
const sched = { "1": { start: "09:00", end: "16:00" }, "2": { start: "09:00", end: "14:00" }, "3": { start: "09:00", end: "16:00" } };
const open = { ma: { open: "08:00", close: "18:00", enabled: true }, di: { open: "08:00", close: "18:00", enabled: true }, wo: { open: "10:00", close: "18:00", enabled: true }, do: { open: "09:00", close: "18:00", enabled: true }, vr: { open: "09:00", close: "18:00", enabled: true }, za: { open: "09:00", close: "17:00", enabled: false }, zo: { open: "09:00", close: "17:00", enabled: false } };
const anna: ScheduleEmployee = { id: "emp-anna", weekly_schedule: sched, breaks: [{ start: "12:00", end: "12:30" }], services: [] };
const bram: ScheduleEmployee = { id: "emp-bram", weekly_schedule: null, working_days: [1, 2, 3, 4, 5], services: ["svc-cut"] };
const ctx = (date: string, extra: Partial<DayContext> = {}): DayContext => ({ date, opening: open, exceptions: [], busy: [], ...extra });
const cut = { id: "svc-cut", name: "Knippen", duration_minutes: 60 };
const facial = { id: "svc-facial", name: "Gezichtsbehandeling", duration_minutes: 90 };

describe("weekly schedule per weekday", () => {
  it("different hours per weekday", () => {
    expect(workingWindow(anna, [], "2026-10-12", open)).toEqual({ start: "09:00", end: "16:00" });
    expect(workingWindow(anna, [], "2026-10-13", open)).toEqual({ start: "09:00", end: "14:00" });
    expect(workingWindow(anna, [], "2026-10-15", open)).toBeNull();
  });
  it("rejects before and after working hours", () => {
    expect(canStart(anna, ctx("2026-10-12"), "08:30", 30)).toBe(false);
    expect(canStart(anna, ctx("2026-10-13"), "14:00", 30)).toBe(false);
    expect(canStart(anna, ctx("2026-10-12"), "09:00", 30)).toBe(true);
  });
  it("rejects a treatment running past the end time", () => {
    expect(canStart(anna, ctx("2026-10-12"), "15:30", 60)).toBe(false);
    expect(canStart(anna, ctx("2026-10-12"), "15:00", 60)).toBe(true);
  });
  it("respects salon opening hours", () => {
    expect(workingWindow(anna, [], "2026-10-14", open)).toEqual({ start: "10:00", end: "16:00" });
  });
  it("validation: end must be after start", () => {
    expect(isValidSchedule({ "1": { start: "16:00", end: "09:00" } })).toBe(false);
    expect(scheduleError({ "1": { start: "16:00", end: "09:00" } })).toMatch(/eindtijd/);
    expect(scheduleError(sched)).toBeNull();
  });
  it("invalid stored schedule fails closed", () => {
    expect(canStart({ id: "x", weekly_schedule: { "8": { start: "09:00", end: "16:00" } } }, ctx("2026-10-12"), "10:00", 30)).toBe(false);
  });
});

describe("breaks, sick leave, vacation", () => {
  it("break blocks overlap", () => expect(canStart(anna, ctx("2026-10-12"), "11:45", 30)).toBe(false));
  it("sick exception blocks the whole day", () => {
    const ex = [{ employee_id: "emp-anna", type: "sick", start_date: "2026-10-12" }];
    expect(canStart(anna, ctx("2026-10-12", { exceptions: ex }), "10:00", 30)).toBe(false);
  });
  it("vacation range blocks every day in range", () => {
    const ex = [{ employee_id: "emp-anna", type: "vacation", start_date: "2026-10-12", end_date: "2026-10-14" }];
    expect(startTimes(anna, ctx("2026-10-14", { exceptions: ex }), 30)).toEqual([]);
  });
  it("status ziek blocks", () => expect(canStart({ ...anna, status: "ziek" }, ctx("2026-10-12"), "10:00", 30)).toBe(false));
  it("partial unavailable exception blocks only its range", () => {
    const ex = [{ employee_id: "emp-anna", type: "unavailable", start_date: "2026-10-12", start_time: "10:00:00", end_time: "11:00:00" }];
    expect(canStart(anna, ctx("2026-10-12", { exceptions: ex }), "10:30", 30)).toBe(false);
    expect(canStart(anna, ctx("2026-10-12", { exceptions: ex }), "11:00", 30)).toBe(true);
  });
  it("another employee's exception does not block", () => {
    const ex = [{ employee_id: "emp-bram", type: "sick", start_date: "2026-10-12" }];
    expect(canStart(anna, ctx("2026-10-12", { exceptions: ex }), "10:00", 30)).toBe(true);
  });
});

describe("legacy employees without schedule", () => {
  it("keep working_days + opening hours", () => {
    expect(workingWindow(bram, [], "2026-10-12", open)).toEqual({ start: "08:00", end: "18:00" });
    expect(canStart(bram, ctx("2026-10-12"), "17:00", 60)).toBe(true);
    expect(withinSchedule(null, "2026-10-12", "20:00", 30)).toBeNull();
  });
  it("are never switched off automatically", () => expect(startTimes(bram, ctx("2026-10-15"), 60).length).toBeGreaterThan(0));
});

describe("public booking resolution", () => {
  const staff = [anna, bram];
  it("rejects an employee from another salon (not in the salon list)", () => {
    expect(resolveBooking(staff, ctx("2026-10-12"), [{ service: cut, time: "10:00", employee: "emp-other-salon" }])).toEqual({ ok: false, reason: "unknown_employee" });
  });
  it("rejects an employee not qualified for the service", () => {
    expect(resolveBooking(staff, ctx("2026-10-12"), [{ service: facial, time: "10:00", employee: "emp-bram" }])).toEqual({ ok: false, reason: "not_qualified" });
    expect(canDoService(bram, cut)).toBe(true);
  });
  it("rejects a time outside the chosen employee's hours", () => {
    expect(resolveBooking(staff, ctx("2026-10-13"), [{ service: cut, time: "14:00", employee: "emp-anna" }])).toEqual({ ok: false, reason: "unavailable" });
  });
  it("auto choice picks an available qualified employee", () => {
    const r = resolveBooking(staff, ctx("2026-10-13"), [{ service: cut, time: "15:00", employee: null }]);
    expect(r.ok && r.rows[0].employee).toBe("emp-bram");
  });
  it("no double booking with existing appointments", () => {
    const busy = [{ employee_id: "emp-anna", start: 600, end: 660 }];
    expect(resolveBooking(staff, ctx("2026-10-12", { busy }), [{ service: facial, time: "10:30", employee: "emp-anna" }])).toEqual({ ok: false, reason: "unavailable" });
  });
  it("group booking: second person on same time gets a different employee, never the same one twice", () => {
    const r = resolveBooking(staff, ctx("2026-10-12"), [{ service: cut, time: "10:00", employee: null }, { service: cut, time: "10:00", employee: null }]);
    expect(r.ok && r.rows.map((x) => x.employee)).toEqual(["emp-anna", "emp-bram"]);
    const full = resolveBooking(staff, ctx("2026-10-12"), [{ service: cut, time: "10:00", employee: null }, { service: cut, time: "10:00", employee: null }, { service: cut, time: "10:00", employee: null }]);
    expect(full.ok).toBe(false);
  });
  it("slots only list real availability", () => {
    const busy = [{ employee_id: "emp-anna", start: 540, end: 600 }];
    const slots = startTimes(anna, ctx("2026-10-13", { busy }), 60, 30);
    expect(slots).toEqual(["10:00", "10:30", "11:00", "12:30", "13:00"]);
  });
});

describe("Dutch local time (summer and winter time)", () => {
  it("summer time = UTC+2", () => expect(amsterdamToUtc("2026-07-01", "10:00").toISOString()).toBe("2026-07-01T08:00:00.000Z"));
  it("winter time = UTC+1", () => expect(amsterdamToUtc("2026-12-01", "10:00").toISOString()).toBe("2026-12-01T09:00:00.000Z"));
  it("day after switch to winter time (25 Oct 2026)", () => expect(amsterdamToUtc("2026-10-26", "09:00").toISOString()).toBe("2026-10-26T08:00:00.000Z"));
  it("day of switch to summer time (29 Mar 2026)", () => expect(amsterdamToUtc("2026-03-29", "10:00").toISOString()).toBe("2026-03-29T08:00:00.000Z"));
  it("round trip", () => expect(utcToAmsterdam("2026-07-01T08:00:00Z")).toEqual({ date: "2026-07-01", minutes: 600 }));
  it("existing appointments map to local busy blocks", () => {
    expect(busyFromAppointments("2026-07-01", [{ appointment_date: "2026-07-01T08:00:00Z", end_time: "11:00", employee_id: "emp-anna" }, { appointment_date: "2026-07-01T09:00:00Z", end_time: "12:00", employee_id: "emp-anna", status: "geannuleerd" }]))
      .toEqual([{ employee_id: "emp-anna", start: 600, end: 660 }]);
  });
});

import { normalizeBusyEmployees } from "../../supabase/functions/_shared/inactive/employeeSchedule";

describe("legacy / unknown employee ids in existing appointments", () => {
  const staff = [anna, bram];
  const known = new Set(["emp-anna", "emp-bram"]);
  const rows = (employee_id: string | null) => [{ appointment_date: "2026-10-12T08:00:00Z", end_time: "11:00", employee_id }]; // 10:00-11:00 local
  for (const legacy of ["Bas", "Roos", "emp-deleted", null]) {
    it(`appointment with employee ${legacy ?? "NULL"} blocks every employee`, () => {
      const busy = busyFromAppointments("2026-10-12", normalizeBusyEmployees(rows(legacy), known));
      expect(busy[0].employee_id).toBeNull();
      expect(resolveBooking(staff, ctx("2026-10-12", { busy }), [{ service: cut, time: "10:00", employee: "emp-anna" }]).ok).toBe(false);
      expect(resolveBooking(staff, ctx("2026-10-12", { busy }), [{ service: cut, time: "10:30", employee: null }]).ok).toBe(false);
      expect(resolveBooking(staff, ctx("2026-10-12", { busy }), [{ service: cut, time: "11:00", employee: null }]).ok).toBe(true);
    });
  }
  it("known employee only blocks that employee", () => {
    const busy = busyFromAppointments("2026-10-12", normalizeBusyEmployees(rows("emp-anna"), known));
    const r = resolveBooking(staff, ctx("2026-10-12", { busy }), [{ service: cut, time: "10:00", employee: null }]);
    expect(r.ok && r.rows[0].employee).toBe("emp-bram");
  });
  it("an old page sending a name is refused, never silently reassigned", () => {
    expect(resolveBooking(staff, ctx("2026-10-12"), [{ service: cut, time: "10:00", employee: "Bas" }])).toEqual({ ok: false, reason: "unknown_employee" });
  });
});
