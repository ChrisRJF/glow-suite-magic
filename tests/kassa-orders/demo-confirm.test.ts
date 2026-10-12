import { describe, it, expect } from "vitest";
import { evaluateDemoConfirmation, type DemoConfirmInput } from "../../supabase/functions/_shared/demoAppointmentConfirm";
import { demoConfirmedCents } from "@/lib/demoAppointmentPaid";

const PID = "11111111-1111-4111-8111-111111111111";
const base = (): DemoConfirmInput => ({
  payment: { id: PID, user_id: "t-demo", is_demo: true, provider: "viva", amount: 35, metadata: { checkout: "appointment_checkout", environment: "demo", terminal_id: "999" } },
  tenantIsDemo: true, transactionId: "tx-1", eventMerchantTrns: PID, eventTerminalId: "999",
  verified: { statusId: "F", amountCents: 3500 },
});
const ev = (i: DemoConfirmInput) => evaluateDemoConfirmation(i, "2026-01-01T00:00:00Z");

describe("demo appointment confirmation", () => {
  it("accepts a Viva-verified €35 demo approval", () => {
    const r = ev(base());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.amount_cents).toBe(3500);
  });
  it("rejects live payments", () => { const i = base(); i.payment.is_demo = false; expect(ev(i)).toEqual({ ok: false, reason: "not_demo_payment" }); });
  it("rejects a non-demo tenant", () => { const i = base(); i.tenantIsDemo = false; expect(ev(i)).toEqual({ ok: false, reason: "tenant_not_demo" }); });
  it("rejects live environment metadata", () => { const i = base(); i.payment.metadata!.environment = "live"; expect(ev(i)).toEqual({ ok: false, reason: "not_demo_environment" }); });
  it("rejects non appointment-checkout payments", () => { const i = base(); i.payment.metadata = { environment: "demo" }; expect(ev(i)).toEqual({ ok: false, reason: "not_appointment_checkout" }); });
  it("rejects amount mismatch from provider", () => { const i = base(); i.verified = { statusId: "F", amountCents: 3400 }; expect(ev(i)).toEqual({ ok: false, reason: "amount_mismatch" }); });
  it("rejects when provider lookup failed", () => { const i = base(); i.verified = null; expect(ev(i)).toEqual({ ok: false, reason: "provider_unverified" }); });
  it("rejects non-approved provider status", () => { const i = base(); i.verified = { statusId: "E", amountCents: 3500 }; expect(ev(i)).toEqual({ ok: false, reason: "provider_not_approved" }); });
  it("rejects other payment reference or terminal", () => {
    const a = base(); a.eventMerchantTrns = "other"; expect(ev(a)).toEqual({ ok: false, reason: "reference_mismatch" });
    const b = base(); b.eventTerminalId = "1"; expect(ev(b)).toEqual({ ok: false, reason: "terminal_mismatch" });
  });
  it("is idempotent: second event does not record again", () => {
    const i = base(); i.payment.metadata!.demo_provider_confirmation = { transaction_id: "tx-1" };
    expect(ev(i)).toEqual({ ok: false, reason: "already_confirmed" });
  });
  it("display helper only counts demo confirmations", () => {
    expect(demoConfirmedCents([])).toBeNull();
    expect(demoConfirmedCents([{ metadata: { demo_provider_confirmation: { amount_cents: 3500, environment: "demo" } } }])).toBe(3500);
    expect(demoConfirmedCents([{ metadata: { demo_provider_confirmation: { amount_cents: 3500, environment: "live" } } }])).toBeNull();
  });
});
