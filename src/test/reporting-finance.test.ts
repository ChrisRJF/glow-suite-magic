import { describe, it, expect } from "vitest";
import { buildReports } from "@/lib/reporting";

const appt = (o: Record<string, unknown> = {}) => ({
  id: "a1", customer_id: "c1", service_id: null, appointment_date: "2026-10-10T10:00:00Z",
  status: "voltooid", payment_status: "betaald", price: 50, amount_paid: 50, is_demo: false, ...o,
}) as any;
const pay = (o: Record<string, unknown> = {}) => ({
  id: "p1", customer_id: "c1", amount: 100, status: "paid", created_at: "2026-10-05T10:00:00Z", is_demo: false, ...o,
}) as any;
const refund = (o: Record<string, unknown> = {}) => ({
  id: "r1", amount: 30, status: "processed", created_at: "2026-10-08T10:00:00Z", is_demo: false, ...o,
}) as any;

const build = (over: Partial<Parameters<typeof buildReports>[0]> = {}) =>
  buildReports({ appointments: [], customers: [], services: [], payments: [], refunds: [], mode: "live", from: "2026-10-01", to: "2026-10-31", ...over });

describe("bruto en netto ontvangsten", () => {
  it("netto = bruto minus refunds met refunddatum in de periode", () => {
    const r = build({ payments: [pay()], refunds: [refund()] });
    expect(r.revenue.period).toBe(100);
    expect(r.revenue.refundTotal).toBe(30);
    expect(r.revenue.net).toBe(70);
  });
  it("refund van een oude betaling verlaagt netto in de huidige periode, bruto blijft gelijk", () => {
    const r = build({ payments: [pay({ created_at: "2026-09-10T10:00:00Z" })], refunds: [refund()] });
    expect(r.revenue.period).toBe(0);
    expect(r.revenue.net).toBe(-30);
  });
  it("refund buiten de periode wordt niet afgetrokken", () => {
    const r = build({ payments: [pay()], refunds: [refund({ created_at: "2026-11-01T10:00:00Z" })] });
    expect(r.revenue.net).toBe(100);
  });
  it("nul betalingen en nul refunds geeft netto 0", () => {
    expect(build().revenue.net).toBe(0);
  });
  it("niet-uitgevoerde refunds tellen niet mee", () => {
    const r = build({ payments: [pay()], refunds: [refund({ status: "pending" })] });
    expect(r.revenue.net).toBe(100);
  });
  it("demo en live worden gescheiden", () => {
    const r = build({ payments: [pay(), pay({ id: "p2", is_demo: true, amount: 999 })], refunds: [refund({ is_demo: true, amount: 999 })] });
    expect(r.revenue.period).toBe(100);
    expect(r.revenue.net).toBe(100);
  });
});

describe("geen gefabuleerde groei of prognose", () => {
  it("zonder betalingen is de trend 0, geen verzonnen percentage", () => {
    const r = build({ appointments: [appt()] });
    expect(r.revenue.period).toBe(0);
    expect(r.revenue.trend).toBe(0);
  });
});
