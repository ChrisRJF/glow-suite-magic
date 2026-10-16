import { describe, it, expect } from "vitest";
import {
  decidePublicBookingPayment as decide, appointmentPaymentStatus, webhookAttributionOk, LIVE_ISV_ORDER_ROUTING_AVAILABLE,
  type DecisionInput,
} from "../../supabase/functions/_shared/inactive/publicBookingPaymentGuard.ts";

const T = "salon-a";
const merchant = { user_id: T, viva_merchant_id: "m-a", viva_source_code: "4321" };
const base = (o: Partial<DecisionInput> = {}): DecisionInput => ({
  tenantId: T, appointmentOwnerId: T, gate: { ok: true, demo: false }, merchant, existing: [], ...o,
});

describe("public booking payment guard (no provider calls)", () => {
  it("routing to salon merchants is off in production", () => {
    expect(LIVE_ISV_ORDER_ROUTING_AVAILABLE).toBe(false);
    expect(decide(base())).toEqual({ kind: "no_charge_pending", reason: "salon_routing_unavailable" });
  });
  it("pending KYC blocks", () => {
    const d = decide(base({ gate: { ok: false, demo: false, reason: "kyc_not_ready" }, routingAvailable: true }));
    expect(d).toEqual({ kind: "no_charge_pending", reason: "kyc_not_ready" });
    expect(appointmentPaymentStatus(d)).toBe("payment_pending");
  });
  it("unclear demo/live blocks", () => {
    expect(decide(base({ gate: { ok: false, demo: null, reason: "mode_unclear" } })).kind).toBe("no_charge_pending");
  });
  it("demo is simulated, never a provider order", () => {
    const d = decide(base({ gate: { ok: true, demo: true }, routingAvailable: true }));
    expect(d.kind).toBe("demo_simulated");
  });
  it("merchant of another salon blocks", () => {
    expect(decide(base({ merchant: { ...merchant, user_id: "salon-b" }, routingAvailable: true })).kind).toBe("no_charge_pending");
  });
  it("missing or placeholder source code blocks", () => {
    expect(decide(base({ merchant: { ...merchant, viva_source_code: "" }, routingAvailable: true }))).toEqual({ kind: "no_charge_pending", reason: "source_code_missing" });
    expect(decide(base({ merchant: { ...merchant, viva_source_code: "1234" }, routingAvailable: true })).kind).toBe("no_charge_pending");
  });
  it("verified salon routes to its own merchant only when routing exists", () => {
    expect(decide(base({ routingAvailable: true }))).toEqual({ kind: "isv_order", merchantId: "m-a", sourceCode: "4321" });
  });
  it("cross-tenant appointment or payment blocks", () => {
    expect(decide(base({ appointmentOwnerId: "salon-b", routingAvailable: true })).kind).toBe("no_charge_pending");
    expect(decide(base({ existing: [{ id: "p", user_id: "salon-b", appointment_id: "a", status: "pending", provider: "viva" }], routingAvailable: true })))
      .toEqual({ kind: "no_charge_pending", reason: "cross_tenant_payment" });
  });
  it("duplicate retry reuses the existing payment, no second order", () => {
    const d = decide(base({ existing: [{ id: "p1", user_id: T, appointment_id: "a", status: "pending", provider: "viva" }], routingAvailable: true }));
    expect(d).toEqual({ kind: "reuse_existing", paymentId: "p1" });
  });
  it("webhook attribution requires one owning merchant matching the stored merchant", () => {
    const owners = [{ user_id: T, viva_merchant_id: "m-a" }, { user_id: "salon-b", viva_merchant_id: "m-b" }];
    const pay = { user_id: T, metadata: { viva_merchant_id: "m-a" } };
    expect(webhookAttributionOk(pay, "m-a", owners)).toBe(true);
    expect(webhookAttributionOk(pay, "m-b", owners)).toBe(false);
    expect(webhookAttributionOk(pay, null, owners)).toBe(false);
    expect(webhookAttributionOk({ user_id: T, metadata: {} }, "m-a", owners)).toBe(false);
    expect(webhookAttributionOk(pay, "m-a", [...owners, { user_id: "x", viva_merchant_id: "m-a" }])).toBe(false);
  });
});
