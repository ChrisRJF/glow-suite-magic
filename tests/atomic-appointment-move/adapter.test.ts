import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { guardedMove, appointmentLocalSlot } from "../../docs/prepared-patches/atomic-appointment-move/moveAppointmentCore";

const apt = { id: "a1", updated_at: "2026-10-10T10:00:00.123456+00:00" };
const target = { date: "2026-10-12", time: "11:00", employeeId: "e1" };

describe("guardedMove: fail closed, never legacy writes", () => {
  it("gate off blocks without calling the server", async () => {
    const rpc = vi.fn();
    const r = await guardedMove(apt, target, { enabled: false, rpc });
    expect(r).toMatchObject({ ok: false, code: "disabled" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("missing updated_at blocks without calling the server", async () => {
    for (const a of [{ id: "a1" }, { id: "a1", updated_at: null }, { id: "a1", updated_at: "" }]) {
      const rpc = vi.fn();
      const r = await guardedMove(a, target, { enabled: true, rpc });
      expect(r.code).toBe("missing_version");
      expect(rpc).not.toHaveBeenCalled();
    }
  });
  it("sends the exact version to the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, code: "moved", updated_at: "v2" }, error: null });
    const r = await guardedMove(apt, target, { enabled: true, rpc });
    expect(rpc).toHaveBeenCalledWith("move_appointment_atomic", expect.objectContaining({ _expected_updated_at: apt.updated_at }));
    expect(r).toEqual({ ok: true, code: "moved", updatedAt: "v2" });
  });
  it("RPC not deployed (PGRST202 / 404) is blocked as unavailable", async () => {
    for (const error of [{ code: "PGRST202" }, { status: 404 }, { code: "42883" }]) {
      const r = await guardedMove(apt, target, { enabled: true, rpc: async () => ({ data: null, error }) });
      expect(r).toMatchObject({ ok: false, code: "unavailable" });
    }
  });
  it("network exception is blocked", async () => {
    const r = await guardedMove(apt, target, { enabled: true, rpc: async () => { throw new Error("offline"); } });
    expect(r.code).toBe("unavailable");
  });
  it("stale, noop and unknown codes", async () => {
    const mk = (data: any) => guardedMove(apt, target, { enabled: true, rpc: async () => ({ data, error: null }) });
    expect((await mk({ ok: false, code: "stale" })).message).toMatch(/net gewijzigd/);
    expect(await mk({ ok: true, code: "noop" })).toMatchObject({ ok: true, code: "noop" });
    expect(await mk({ ok: false, code: "iets_nieuws" })).toMatchObject({ ok: false, code: "failed" });
    expect(await mk({ ok: true, code: "iets_nieuws" })).toMatchObject({ ok: false, code: "failed" });
  });
  it("prepared adapter and patch contain no direct appointment writes", () => {
    const dir = resolve(__dirname, "../../docs/prepared-patches/atomic-appointment-move");
    for (const f of ["moveAppointmentCore.ts", "moveAppointmentRpc.ts", "calendarPage.applyMove.patch.md"]) {
      const src = readFileSync(resolve(dir, f), "utf8").replace(/^\s*(\/\/|#|>).*$/gm, "");
      expect(src).not.toMatch(/from\(["']appointments["']\)/);
      expect(src).not.toMatch(/from\(["']appointment_employees["']\)/);
      expect(src).not.toMatch(/applyMoveLegacy/);
    }
  });
});

describe("appointmentLocalSlot: mixed storage", () => {
  it("new real UTC (online booking, CEST and CET)", () => {
    expect(appointmentLocalSlot("2026-10-12T07:00:00+00:00", "09:00:00")).toEqual({ kind: "canonical", date: "2026-10-12", time: "09:00" });
    expect(appointmentLocalSlot("2026-10-26T08:00:00+00:00", "09:00")).toEqual({ kind: "canonical", date: "2026-10-26", time: "09:00" });
  });
  it("old calendar wall clock stored as UTC, incl. late evening", () => {
    expect(appointmentLocalSlot("2026-10-12T09:00:00+00:00", "09:00")).toEqual({ kind: "legacy", date: "2026-10-12", time: "09:00" });
    expect(appointmentLocalSlot("2026-10-16T23:30:00+00:00", "23:30")).toEqual({ kind: "legacy", date: "2026-10-16", time: "23:30" });
  });
  it("real UTC just after midnight lands on the next local day", () => {
    expect(appointmentLocalSlot("2026-10-16T22:30:00+00:00", "00:30")).toEqual({ kind: "canonical", date: "2026-10-17", time: "00:30" });
  });
  it("ambiguous or missing start time fails closed", () => {
    expect(appointmentLocalSlot("2026-10-22T09:00:00+00:00", "10:00").kind).toBe("ambiguous");
    expect(appointmentLocalSlot("2026-10-22T09:00:00+00:00", null).kind).toBe("ambiguous");
    expect(appointmentLocalSlot("geen datum", "10:00").kind).toBe("ambiguous");
  });
});

import { amsterdamWallToUtc, appointmentInstant, reminderDue } from "../../docs/prepared-patches/atomic-appointment-move/moveAppointmentCore";

describe("time conversion and reminders (fictional times)", () => {
  it("wall clock to UTC incl. DST, gap and repeat refused", () => {
    expect(amsterdamWallToUtc("2026-10-12", "09:00")?.toISOString()).toBe("2026-10-12T07:00:00.000Z");
    expect(amsterdamWallToUtc("2026-10-26", "09:00")?.toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(amsterdamWallToUtc("2026-03-29", "02:30")).toBeNull();
    expect(amsterdamWallToUtc("2026-10-25", "02:30")).toBeNull();
    expect(amsterdamWallToUtc("2026-10-25", "03:00")?.toISOString()).toBe("2026-10-25T02:00:00.000Z");
  });
  it("old and new rows give the same real start", () => {
    const newRow = appointmentInstant("2026-10-13T08:00:00+00:00", "10:00");
    const oldRow = appointmentInstant("2026-10-13T10:00:00+00:00", "10:00");
    expect(newRow?.toISOString()).toBe("2026-10-13T08:00:00.000Z");
    expect(oldRow?.toISOString()).toBe(newRow?.toISOString());
  });
  it("24h and 2h reminders fire for old and new rows at the same moment", () => {
    const now = new Date("2026-10-12T08:30:00Z"); // 10:30 local, appointment Tue 13 Oct 10:00 local
    expect(reminderDue("2026-10-13T08:00:00+00:00", "10:00", now, "24h").due).toBe(true);
    expect(reminderDue("2026-10-13T10:00:00+00:00", "10:00", now, "24h").due).toBe(true);
    const now2 = new Date("2026-10-13T06:00:00Z"); // 08:00 local, 2 h before
    expect(reminderDue("2026-10-13T08:00:00+00:00", "10:00", now2, "2h").due).toBe(true);
    expect(reminderDue("2026-10-13T10:00:00+00:00", "10:00", now2, "2h").due).toBe(true);
    expect(reminderDue("2026-10-13T08:00:00+00:00", "10:00", new Date("2026-10-13T07:30:00Z"), "2h").due).toBe(false);
  });
  it("reminder across the October DST switch uses real hours", () => {
    // Mon 26 Oct 09:00 CET = 08:00Z; 24 h earlier is Sun 25 Oct 08:00Z
    expect(reminderDue("2026-10-26T08:00:00+00:00", "09:00", new Date("2026-10-25T08:00:00Z"), "24h").due).toBe(true);
    expect(reminderDue("2026-10-26T08:00:00+00:00", "09:00", new Date("2026-10-25T06:30:00Z"), "24h").due).toBe(false);
  });
  it("unknown time: no reminder, flagged", () => {
    expect(reminderDue("2026-10-22T09:00:00+00:00", "10:00", new Date("2026-10-21T09:00:00Z"), "24h")).toEqual({ due: false, reason: "unknown_time" });
    expect(reminderDue("2026-10-22T09:00:00+00:00", null, new Date("2026-10-21T09:00:00Z"), "24h").reason).toBe("unknown_time");
  });
});
