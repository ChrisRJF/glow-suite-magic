import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  agendaModeFromFlagRead, routeAgendaWrite, guardedCreate, guardedPlaceWaitlist, amsterdamTomorrow,
} from "../../docs/prepared-patches/atomic-appointment-move/agendaWriteCore";
import { guardedMove } from "../../docs/prepared-patches/atomic-appointment-move/moveAppointmentCore";

const E1 = "11111111-1111-4111-8111-111111111111";
const E2 = "22222222-2222-4222-8222-222222222222";
const base = { customerId: "c1", serviceId: "s1", date: "2026-10-20", time: "10:00", employeeIds: [E1], source: "manual" as const };
const ok = (extra: any = {}) => vi.fn().mockResolvedValue({ data: { ok: true, code: "created", appointment_id: "a1", ...extra }, error: null });

describe("mode per salon: publishing never blocks salons with the flag off", () => {
  it("flag row false or missing = legacy, true = atomic, read error/odd value = blocked", () => {
    expect(agendaModeFromFlagRead({ data: { atomic_agenda_enabled: false }, error: null })).toBe("legacy");
    expect(agendaModeFromFlagRead({ data: null, error: null })).toBe("legacy");
    expect(agendaModeFromFlagRead({ data: { atomic_agenda_enabled: true }, error: null })).toBe("atomic");
    expect(agendaModeFromFlagRead({ data: null, error: { code: "x" } })).toBe("blocked");
    for (const v of ["true", 1, null]) expect(agendaModeFromFlagRead({ data: { atomic_agenda_enabled: v }, error: null })).toBe("blocked");
  });
  it("atomic mode never reaches legacy, even when the RPC fails", async () => {
    const legacy = vi.fn();
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    const r = await routeAgendaWrite("atomic", () => guardedCreate(base, { mode: "atomic", rpc }), legacy, () => null as any);
    expect(r.code).toBe("unavailable");
    expect(legacy).not.toHaveBeenCalled();
  });
  it("legacy mode never calls the RPC; blocked mode writes nothing", async () => {
    const rpc = vi.fn(); const legacy = vi.fn().mockResolvedValue("legacy");
    expect(await routeAgendaWrite("legacy", () => guardedCreate(base, { mode: "atomic", rpc }), legacy, () => "b")).toBe("legacy");
    expect(rpc).not.toHaveBeenCalled();
    const l2 = vi.fn();
    expect(await routeAgendaWrite("blocked", vi.fn(), l2, () => "b")).toBe("b");
    expect(l2).not.toHaveBeenCalled();
  });
});

describe("guardedCreate", () => {
  it("gate checked before the RPC", async () => {
    for (const mode of ["legacy", "blocked"] as const) {
      const rpc = vi.fn();
      expect((await guardedCreate(base, { mode, rpc })).code).toBe("disabled");
      expect(rpc).not.toHaveBeenCalled();
    }
  });
  it("one employee: UUIDs and Amsterdam wall clock sent unchanged", async () => {
    const rpc = ok();
    const r = await guardedCreate(base, { mode: "atomic", rpc });
    expect(r).toMatchObject({ ok: true, appointmentId: "a1" });
    expect(rpc).toHaveBeenCalledWith("create_appointment_atomic", expect.objectContaining({ _date: "2026-10-20", _time: "10:00", _employee_ids: [E1], _source: "manual" }));
  });
  it("multiple employees + group with own time and employee in one call", async () => {
    const rpc = ok();
    await guardedCreate({ ...base, employeeIds: [E1, E2], group: [{ personName: "Fictief B", serviceId: "s2", time: "10:30", employeeId: E2 }] }, { mode: "atomic", rpc });
    const args = rpc.mock.calls[0][1];
    expect(args._employee_ids).toEqual([E1, E2]);
    expect(args._sub_appointments).toEqual([{ person_name: "Fictief B", service_id: "s2", time: "10:30", employee_id: E2 }]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("employee names and group lines without time are refused before the RPC", async () => {
    const rpc = vi.fn();
    expect((await guardedCreate({ ...base, employeeIds: ["Marie"] }, { mode: "atomic", rpc })).code).toBe("invalid_employee");
    expect((await guardedCreate({ ...base, group: [{ personName: "B", serviceId: "s2" }] }, { mode: "atomic", rpc })).code).toBe("group_line_needs_time");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("busy, break, absence and race loser map to messages, nothing saved", async () => {
    for (const code of ["conflict", "in_break", "employee_absent", "not_working", "slot_unavailable"]) {
      const r = await guardedCreate(base, { mode: "atomic", rpc: async () => ({ data: { ok: false, code }, error: null }) });
      expect(r.ok).toBe(false); expect(r.message).toBeTruthy();
    }
  });
  it("failed call or unknown answer = blocked without fallback", async () => {
    expect((await guardedCreate(base, { mode: "atomic", rpc: async () => { throw new Error("net"); } })).code).toBe("unavailable");
    expect((await guardedCreate(base, { mode: "atomic", rpc: async () => ({ data: null, error: { code: "XX000" } }) })).code).toBe("failed");
    expect((await guardedCreate(base, { mode: "atomic", rpc: async () => ({ data: { ok: true, code: "created" }, error: null }) })).code).toBe("failed");
  });
});

describe("move: all routes share guardedMove", () => {
  const apt = { id: "a1", updated_at: "v1" };
  it("other time and other employee go in one call with the version", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, code: "moved", updated_at: "v2" }, error: null });
    await guardedMove(apt, { date: "2026-10-21", time: "14:00", employeeId: E2 }, { enabled: true, rpc });
    expect(rpc).toHaveBeenCalledWith("move_appointment_atomic", { _appointment_id: "a1", _target_date: "2026-10-21", _target_start: "14:00", _target_employee_id: E2, _expected_updated_at: "v1" });
  });
  it("stale version and multi employee are refused", async () => {
    for (const code of ["stale", "multi_employee_unsupported"]) {
      const r = await guardedMove(apt, { date: "2026-10-21", time: "14:00", employeeId: E1 }, { enabled: true, rpc: async () => ({ data: { ok: false, code }, error: null }) });
      expect(r.ok).toBe(false);
    }
  });
  it("mobile sheet cancelled = no call (patch only calls applyMove on confirm)", () => {
    const p = readFileSync(resolve(__dirname, "../../docs/prepared-patches/atomic-appointment-move/calendarPage.applyMove.patch.md"), "utf8");
    expect(p).toMatch(/onCancel[^\n]*no write/);
  });
});

describe("waitlist placement", () => {
  const entry = { id: "w1", customer_id: "c1", service_id: "s1", preferred_time: "11:15" };
  const now = new Date("2026-10-24T22:30:00Z"); // already 25 Oct in Amsterdam (CEST)
  it("Amsterdam tomorrow, not browser time (incl. DST end)", () => {
    expect(amsterdamTomorrow(now)).toBe("2026-10-26");
    expect(amsterdamTomorrow(new Date("2026-10-12T10:00:00Z"))).toBe("2026-10-13");
  });
  it("marked placed only after success", async () => {
    const markPlaced = vi.fn().mockResolvedValue(true); const rpc = ok();
    const r = await guardedPlaceWaitlist(entry, { mode: "atomic", rpc, now, markPlaced });
    expect(r).toMatchObject({ ok: true, marked: true });
    expect(rpc.mock.calls[0][1]).toMatchObject({ _date: "2026-10-26", _time: "11:15", _employee_ids: [], _source: "waitlist" });
  });
  it("refused or failed = entry stays on the waitlist", async () => {
    for (const rpc of [async () => ({ data: { ok: false, code: "conflict" }, error: null }), async () => { throw new Error("x"); }]) {
      const markPlaced = vi.fn();
      const r = await guardedPlaceWaitlist(entry, { mode: "atomic", rpc: rpc as any, now, markPlaced });
      expect(r.marked).toBe(false); expect(markPlaced).not.toHaveBeenCalled();
    }
  });
});

describe("prepared files contain no direct appointment writes", () => {
  it("core and patches", () => {
    const dir = resolve(__dirname, "../../docs/prepared-patches/atomic-appointment-move");
    for (const f of ["agendaWriteCore.ts", "calendarPage.create.patch.md", "wachtlijst.place.patch.md"]) {
      const src = readFileSync(resolve(dir, f), "utf8");
      const atomicPart = src.split("LEGACY-UNCHANGED")[0];
      expect(atomicPart).not.toMatch(/from\(["'](appointments|appointment_employees|sub_appointments)["']\)/);
    }
  });
  it("create patch checks the gate before the RPC", () => {
    const p = readFileSync(resolve(__dirname, "../../docs/prepared-patches/atomic-appointment-move/calendarPage.create.patch.md"), "utf8");
    expect(p.indexOf("routeAgendaWrite")).toBeGreaterThan(-1);
    expect(p.indexOf("isAgendaGateOn")).toBe(-1);
  });
});
