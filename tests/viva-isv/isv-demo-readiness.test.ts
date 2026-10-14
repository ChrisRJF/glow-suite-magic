import { describe, it, expect } from "vitest";
import { assertIsvOrderTarget, auditOrderBody, isvAwareMarginDecision, confirmedIsvCommission } from "../../supabase/functions/_shared/inactive/isvDemoReadiness";
import { prepareOnlineIsvOrder } from "../../supabase/functions/_shared/inactive/vivaIsvPrepared";

const env = { VIVA_ISV_DEMO_ENABLED: "true", VIVA_ISV_CLIENT_ID: "x", VIVA_ISV_CLIENT_SECRET: "y" };
const merchant = { user_id: "t1", viva_merchant_id: "m-1", viva_source_code: "1234", onboarding_status: "active", is_demo: true } as any;

describe("ISV demo readiness", () => {
  it("€1,00 order sends isvAmount 35 to the ISV endpoint with merchantId in query", () => {
    const p = prepareOnlineIsvOrder({ env, merchant, amountCents: 100, description: "demo" });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(assertIsvOrderTarget(p.url, p.query)).toBe("ok");
    expect(p.body.isvAmount).toBe(35);
    expect(p.body.amount).toBe(100);
    expect("merchantId" in p.body).toBe(false);
  });
  it("plain merchant order path is refused", () => {
    expect(assertIsvOrderTarget("/checkout/v2/orders", { merchantId: "m" })).toBe("not_isv_endpoint");
    expect(assertIsvOrderTarget("/checkout/v2/isv/orders", {})).toBe("merchant_id_missing");
  });
  it("audit body keeps money fields and drops personal data", () => {
    const a = auditOrderBody({ amount: 100, isvAmount: 35, sourceCode: "1234", customer: { email: "a@b.nl" }, customerTrns: "x" });
    expect(a).toEqual({ amount: 100, isvAmount: 35, sourceCode: "1234", has_isvAmount: true, isvAmount_is_integer_cents: true });
  });
  it("ISV payment never gets the legacy €0,30 margin", () => {
    expect(isvAwareMarginDecision({ isDemo: false, isPaid: true, txVerified: true, meta: { isv: true } })).toBe("not_applicable");
    expect(isvAwareMarginDecision({ isDemo: false, isPaid: true, txVerified: true, meta: {} })).toBe("record");
  });
  it("confirmed commission only with verified, paid, matching tx and valid cents", () => {
    const base = { txVerified: true, paymentStatus: "paid", paymentTxId: "t", eventTxId: "t", feeCents: 35, paymentAmountCents: 100 };
    expect(confirmedIsvCommission(base)).toEqual({ ok: true, cents: 35 });
    expect(confirmedIsvCommission({ ...base, txVerified: false })).toMatchObject({ ok: false });
    expect(confirmedIsvCommission({ ...base, paymentStatus: "failed" })).toMatchObject({ ok: false });
    expect(confirmedIsvCommission({ ...base, eventTxId: "other" })).toMatchObject({ ok: false });
    expect(confirmedIsvCommission({ ...base, feeCents: undefined })).toMatchObject({ ok: false, reason: "fee_missing" });
    expect(confirmedIsvCommission({ ...base, feeCents: 0.35 })).toMatchObject({ ok: false });
    expect(confirmedIsvCommission({ ...base, feeCents: 150 })).toMatchObject({ ok: false });
  });
});
