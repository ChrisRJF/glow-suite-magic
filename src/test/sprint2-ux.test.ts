import { describe, it, expect } from "vitest";
import { searchCustomers } from "@/lib/customerSearch";
import { indexAppointmentsByCustomer } from "@/lib/customerAppointmentIndex";
import { summarizeSchedule } from "@/lib/employeeScheduleSummary";

const customers = Array.from({ length: 15000 }, (_, i) => ({
  id: `c${i}`, name: `Klant ${String(i).padStart(5, "0")}`, email: `klant${i}@fictief.test`, phone: `06${String(10000000 + i)}`,
}));
customers.push({ id: "z", name: "Zoë Zandvoort", email: "zoe@fictief.test", phone: "+31 6 9999 0001" });

describe("klantzoeker bij 15.000 klanten", () => {
  it("leeg zoekveld toont niets", () => expect(searchCustomers(customers, "")).toHaveLength(0));
  it("brede zoekopdracht geeft maximaal 50", () => expect(searchCustomers(customers, "klant").length).toBe(50));
  it("zoekt op naam, e-mail en telefoonvarianten", () => {
    expect(searchCustomers(customers, "zandvoort")[0].id).toBe("z");
    expect(searchCustomers(customers, "ZOE@fictief")[0].id).toBe("z");
    for (const q of ["0699990001", "+31699990001", "0031 6 9999 0001", "+31 (0)6 9999 0001", "06-9999-0001"]) {
      expect(searchCustomers(customers, q).map((c) => c.id)).toContain("z");
    }
  });
  it("geen resultaat", () => expect(searchCustomers(customers, "bestaatniet")).toHaveLength(0));
  it("is snel genoeg", () => {
    const t = performance.now(); searchCustomers(customers, "0699"); expect(performance.now() - t).toBeLessThan(200);
  });
});

describe("afsprakenindex per klant", () => {
  it("zelfde resultaat als oude filter+sort, zonder geannuleerde", () => {
    const appts = [
      { customer_id: "a", status: "gepland", appointment_date: "2026-01-01T10:00:00Z" },
      { customer_id: "a", status: "geannuleerd", appointment_date: "2026-09-01T10:00:00Z" },
      { customer_id: "a", status: "voltooid", appointment_date: "2026-05-01T10:00:00Z" },
      { customer_id: "b", status: "gepland", appointment_date: "2026-02-01T10:00:00Z" },
      { customer_id: null, status: "gepland", appointment_date: "2026-02-01T10:00:00Z" },
    ];
    const old = (id: string) => appts.filter((a) => a.customer_id === id && a.status !== "geannuleerd")
      .sort((x, y) => +new Date(y.appointment_date) - +new Date(x.appointment_date));
    const idx = indexAppointmentsByCustomer(appts);
    expect(idx.get("a")).toEqual(old("a"));
    expect(idx.get("a")![0].appointment_date).toBe("2026-05-01T10:00:00Z");
    expect(idx.get("b")).toEqual(old("b"));
    expect(idx.get("x")).toBeUndefined();
  });
  it("15.000 klanten en 60.000 afspraken in één keer", () => {
    const appts = Array.from({ length: 60000 }, (_, i) => ({ customer_id: `c${i % 15000}`, status: "voltooid", appointment_date: new Date(2026, 0, 1 + (i % 300)).toISOString() }));
    const t = performance.now(); const idx = indexAppointmentsByCustomer(appts);
    expect(idx.size).toBe(15000); expect(idx.get("c1")!.length).toBe(4);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe("werktijden op teamkaart", () => {
  it("weekpatroon wordt gegroepeerd", () => {
    const s = summarizeSchedule({ weekly_schedule: { "1": { start: "09:00", end: "16:00" }, "2": { start: "09:00", end: "14:00" }, "3": { start: "09:00", end: "16:00" }, "5": { start: "09:00", end: "16:00" } } });
    expect(s).toEqual({ kind: "schedule", lines: ["ma, wo, vr 09:00–16:00", "di 09:00–14:00"] });
  });
  it("NULL schema houdt werkdagen (oude werking)", () => {
    expect(summarizeSchedule({ weekly_schedule: null, working_days: [1, 3] })).toEqual({ kind: "legacy", days: [1, 3] });
    expect(summarizeSchedule({ weekly_schedule: null, working_days: [] })).toEqual({ kind: "legacy", days: [1, 2, 3, 4, 5] });
  });
  it("ongeldig schema wordt gemeld", () => expect(summarizeSchedule({ weekly_schedule: { "1": { start: "17:00", end: "09:00" } } }).kind).toBe("invalid"));
});
