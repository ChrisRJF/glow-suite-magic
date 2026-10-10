import { describe, it, expect } from "vitest";
import { resolveDropTarget, validateDropWindow, isTouchActivation } from "@/lib/calendarDrop";
import { findConflict } from "@/lib/agendaMove";

const services = [{ id: "s60", duration_minutes: 60 }];
// Two employees with the same name, different IDs
const empA = { id: "emp-a", name: "Tino" };
const empB = { id: "emp-b", name: "Tino" };
const appointments = [
  { id: "apt1", appointment_date: "2026-10-12T09:00:00", start_time: "09:00", service_id: "s60", notes: "" },
  { id: "apt2", appointment_date: "2026-10-12T10:00:00", start_time: "10:00", service_id: "s60", notes: "" },
];
const apptEmployees = [
  { appointment_id: "apt1", employee_id: empA.id },
  { appointment_id: "apt2", employee_id: empB.id },
];

describe("resolveDropTarget", () => {
  it("columns: uses the column employee ID, not the name", () => {
    expect(resolveDropTarget({ slot: "10:00", employeeId: "emp-b" }, "columns", "emp-a"))
      .toEqual({ time: "10:00", employeeId: "emp-b" });
  });
  it("columns: unassigned column maps to null", () => {
    expect(resolveDropTarget({ slot: "10:00", employeeId: "unassigned" }, "columns", "emp-a"))
      .toEqual({ time: "10:00", employeeId: null });
  });
  it("day: keeps current employee", () => {
    expect(resolveDropTarget({ slot: "10:00" }, "day", "emp-a")).toEqual({ time: "10:00", employeeId: "emp-a" });
  });
  it("no slot (outside grid / cancel) is a noop", () => {
    expect(resolveDropTarget(undefined, "day", "emp-a")).toBeNull();
    expect(resolveDropTarget({ type: "x" }, "columns", "emp-a")).toBeNull();
  });
  it("snaps to 15 minutes", () => {
    expect(resolveDropTarget({ slot: "10:07", employeeId: "emp-a" }, "columns", "x")?.time).toMatch(/^10:(00|15)$/);
  });
});

describe("drop validation", () => {
  it("09:00 -> 10:00 for emp A is free (B's 10:00 is another person with the same name)", () => {
    const c = findConflict({
      movingId: "apt1", date: "2026-10-12", startTime: "10:00", durationMinutes: 60,
      targetEmployeeId: empA.id, targetEmployeeName: null, appointments, apptEmployees, services,
    });
    expect(c).toBeNull();
  });
  it("drop on B's occupied 10:00 is blocked", () => {
    const c = findConflict({
      movingId: "apt1", date: "2026-10-12", startTime: "10:00", durationMinutes: 60,
      targetEmployeeId: empB.id, targetEmployeeName: null, appointments, apptEmployees, services,
    });
    expect(c).toContain("10:00");
  });
  it("blocks a drop that runs past the end of the agenda", () => {
    expect(validateDropWindow({ time: "23:30", durationMinutes: 60 })).not.toBeNull();
  });
  it("blocks a drop that overlaps a pause", () => {
    expect(validateDropWindow({ time: "12:00", durationMinutes: 60, isPause: s => s === "12:30" })).toMatch(/pauze/);
    expect(validateDropWindow({ time: "10:00", durationMinutes: 60, isPause: s => s === "12:30" })).toBeNull();
  });
  it("detects touch activation", () => {
    expect(isTouchActivation({ pointerType: "touch" } as any)).toBe(true);
    expect(isTouchActivation({ pointerType: "mouse" } as any)).toBe(false);
    expect(isTouchActivation(null)).toBe(false);
  });
});
