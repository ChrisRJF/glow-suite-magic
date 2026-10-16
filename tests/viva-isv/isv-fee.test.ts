import { describe, it, expect } from "vitest";
import { computeIsvFee, refundIsvFeeCents, validFeeConfig, BUILTIN_FEE } from "../../supabase/functions/_shared/inactive/isvFee.ts";
import { prepareLiveIsvOrder } from "../../supabase/functions/_shared/inactive/isvLiveCheckout.ts";

const cfg = { online_bps: 250, online_fixed_cents: 10, terminal_bps: 150, terminal_fixed_cents: 0 };

describe("per-salon ISV fee", () => {
  it("percentage + fixed, half-up integer cents", () => {
    expect(computeIsvFee(5000, cfg, "online").feeCents).toBe(135); // 2.5% of 50.00 = 125 + 10
    expect(computeIsvFee(1020, { ...cfg, terminal_bps: 150 }, "terminal").feeCents).toBe(15); // 15.3 -> 15
    expect(computeIsvFee(1030, cfg, "terminal").feeCents).toBe(15); // 15.45 -> 15
    expect(computeIsvFee(1034, cfg, "terminal").feeCents).toBe(16); // 15.51 -> 16
  });
  it("builtin default is 35 cents online and 1.5% terminal", () => {
    expect(computeIsvFee(4000, BUILTIN_FEE, "online").feeCents).toBe(35);
    expect(computeIsvFee(4000, BUILTIN_FEE, "terminal").feeCents).toBe(60);
  });
  it("fee always stays below the total and salon net is amount minus fee", () => {
    const b = computeIsvFee(20, cfg, "online");
    expect(b.feeCents).toBe(19);
    expect(b.salonNetCents).toBe(1);
    expect(computeIsvFee(1, cfg, "online").feeCents).toBe(0);
  });
  it("rejects bad config and amounts", () => {
    expect(validFeeConfig({ ...cfg, online_bps: -1 })).toBe(false);
    expect(validFeeConfig({ ...cfg, online_fixed_cents: 1.5 })).toBe(false);
    expect(validFeeConfig({ ...cfg, terminal_bps: 2001 })).toBe(false);
    expect(() => computeIsvFee(10.5, cfg, "online")).toThrow();
  });
  it("refunds return fee proportionally and fully on full refund", () => {
    const s = { amountCents: 10000, feeCents: 35, refundedAmountCents: 0, refundedFeeCents: 0 };
    const first = refundIsvFeeCents(s, 5000);
    expect(first).toBe(18);
    expect(refundIsvFeeCents({ ...s, refundedAmountCents: 5000, refundedFeeCents: first }, 5000)).toBe(17);
    expect(() => refundIsvFeeCents({ ...s, refundedAmountCents: 9000 }, 2000)).toThrow();
  });
});

describe("live order uses per-salon fee as isvAmount", () => {
  const row: any = { user_id: "t1", is_demo: false, viva_merchant_id: "m1" };
  const caps = { online_payments_enabled: true, terminals_enabled: false, reason: "ok" };
  const base = { tenantId: "t1", row, caps, amountCents: 5000, description: "x", successUrl: "s", failureUrl: "f", enabled: true };
  it("isvAmount = salon fee, included in amount", () => {
    const o: any = prepareLiveIsvOrder({ ...base, feeConfig: cfg });
    expect(o.ok).toBe(true);
    expect(o.body.amount).toBe(5000);
    expect(o.body.isvAmount).toBe(135);
    expect(o.body.sourceCode).toBe("Default");
  });
  it("invalid fee config blocks the order", () => {
    expect(prepareLiveIsvOrder({ ...base, feeConfig: { ...cfg, online_bps: 99999 } })).toEqual({ ok: false, error: "invalid_fee_config" });
  });
  it("switch off still blocks everything", () => {
    expect(prepareLiveIsvOrder({ ...base, enabled: undefined, feeConfig: cfg }).ok).toBe(false);
  });
});
