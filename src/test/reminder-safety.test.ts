import { describe, it, expect } from "vitest";
import {
  loadTenantScopedReminderRows,
  reminderWindow,
  inReminderWindow,
  appointmentLocalDate,
  utcBoundsForLocalDays,
  localToUtc,
} from "../../supabase/functions/_shared/inactive/reminderSafety";

// Fictional salons and rows only.
const SALON_A = "aaaaaaaa-0000-0000-0000-000000000001";
const SALON_B = "bbbbbbbb-0000-0000-0000-000000000002";
const db: Record<string, any[]> = {
  appointments: [
    { id: "ap1", user_id: SALON_A, customer_id: "cA", service_id: "sA" },
    { id: "ap2", user_id: SALON_A, customer_id: "cB", service_id: "sA" },
    { id: "ap3", user_id: SALON_A, customer_id: "cA", service_id: "sB" },
  ],
  customers: [{ id: "cA", user_id: SALON_A }, { id: "cB", user_id: SALON_B }],
  services: [{ id: "sA", user_id: SALON_A, name: "Knippen" }, { id: "sB", user_id: SALON_B, name: "Kleuren" }],
};
function fakeAdmin(fail = false) {
  return {
    from(t: string) {
      const f: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { f[k] = v; return q; },
        maybeSingle: async () => fail
          ? { data: null, error: { message: "x" } }
          : { data: db[t].find((r) => Object.entries(f).every(([k, v]) => r[k] === v)) ?? null, error: null },
      };
      return q;
    },
  };
}
const load = (u: string, a: string, fail = false) =>
  loadTenantScopedReminderRows(fakeAdmin(fail), u, a, "id, customer_id, service_id", "id, name");

describe("reminder tenant scoping", () => {
  it("same tenant passes", async () => expect((await load(SALON_A, "ap1")).ok).toBe(true));
  it("customer of another salon fails closed", async () =>
    expect(await load(SALON_A, "ap2")).toEqual({ ok: false, reason: "customer_not_found" }));
  it("service of another salon fails closed", async () =>
    expect(await load(SALON_A, "ap3")).toEqual({ ok: false, reason: "service_not_found" }));
  it("appointment of another salon is not found", async () =>
    expect(await load(SALON_B, "ap1")).toEqual({ ok: false, reason: "appointment_not_found" }));
  it("lookup error fails closed", async () =>
    expect(await load(SALON_A, "ap1", true)).toEqual({ ok: false, reason: "lookup_failed" }));
});

const AMS = "Europe/Amsterdam";
describe("reminder window in salon local time", () => {
  it("01:00 Amsterdam appointment belongs to that local day, not UTC yesterday", () => {
    expect(appointmentLocalDate("2026-06-14T23:00:00Z", AMS)).toBe("2026-06-15");
  });
  it("local day bounds use the salon offset (summer)", () => {
    expect(utcBoundsForLocalDays("2026-06-15", "2026-06-15", AMS)).toEqual({
      startIso: "2026-06-14T22:00:00.000Z", endIsoExclusive: "2026-06-15T22:00:00.000Z",
    });
  });
  it("near midnight: 24h reminder for 00:15 local is found", () => {
    const now = new Date("2026-06-14T22:15:00Z"); // 15 jun 00:15 local
    const w = reminderWindow(now, 24, 15, AMS);
    expect(w.lowDate).toBe("2026-06-15");
    expect(w.highDate).toBe("2026-06-16");
    expect(inReminderWindow(w, "2026-06-15T22:15:00Z", "00:15", AMS)).toBe(true);
    expect(inReminderWindow(w, "2026-06-15T22:15:00Z", "00:15", "UTC")).toBe(false);
  });
  it("spring DST (29 mrt 2026): 23h local day, 10:00 next day at 24h", () => {
    expect(utcBoundsForLocalDays("2026-03-29", "2026-03-29", AMS)).toEqual({
      startIso: "2026-03-28T23:00:00.000Z", endIsoExclusive: "2026-03-29T22:00:00.000Z",
    });
    const w = reminderWindow(new Date("2026-03-28T09:00:00Z"), 24, 15, AMS); // 10:00 CET
    expect(w.lowDate).toBe("2026-03-29");
    // 24 real hours later is 11:00 CEST
    expect(inReminderWindow(w, "2026-03-29T09:00:00Z", "11:00", AMS)).toBe(true);
  });
  it("autumn DST (25 okt 2026): 25h local day", () => {
    expect(utcBoundsForLocalDays("2026-10-25", "2026-10-25", AMS)).toEqual({
      startIso: "2026-10-24T22:00:00.000Z", endIsoExclusive: "2026-10-25T23:00:00.000Z",
    });
    const w = reminderWindow(new Date("2026-10-24T08:00:00Z"), 24, 15, AMS); // 10:00 CEST
    expect(inReminderWindow(w, "2026-10-25T09:00:00Z", "09:00", AMS)).toBe(true);
  });
  it("nonexistent spring time 02:30 resolves forward, other timezone works", () => {
    expect(localToUtc({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, AMS).toISOString())
      .toBe("2026-03-29T01:30:00.000Z");
    expect(appointmentLocalDate("2026-07-01T03:30:00Z", "America/New_York")).toBe("2026-06-30");
  });
});
