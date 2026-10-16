import { describe, it, expect } from "vitest";
import { startLiveDeposit, handleLivePaymentEvent, type DepositDeps, type WebhookDeps } from "../../supabase/functions/_shared/inactive/isvLivePayments.ts";

const MID = "11111111-2222-3333-4444-555555555555";
const TX = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const env = (n: string) => ({ VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_LIVE_CLIENT_ID: "id", VIVA_ISV_LIVE_CLIENT_SECRET: "s" } as Record<string, string>)[n];
const row = { id: "r", user_id: "t1", is_demo: false, viva_account_id: "acc-12345678", viva_merchant_id: MID, viva_source_code: null, onboarding_status: "active", kyc_status: "verified" };
const acc = { accountId: "acc-12345678", merchantId: MID, acquiringEnabled: true, verified: true };
const fee = { online_bps: 100, online_fixed_cents: 25, terminal_bps: 0, terminal_fixed_cents: 0 };

function depDeps(o: Partial<DepositDeps> = {}) {
  const log: any = { posts: [] as any[], inserted: null, failed: null };
  const d: DepositDeps = {
    env, enabled: true, newId: () => "p1",
    fetch: (async (u: string, init?: any) => {
      if (u.includes("token")) return new Response(JSON.stringify({ access_token: "t" }));
      log.posts.push({ u, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ orderCode: 1234567890123456 }));
    }) as any,
    loadMerchant: async () => row, retrieve: async () => acc, feeConfig: async () => fee,
    findExisting: async () => null,
    insertPending: async (p, s) => { log.inserted = { p, s }; return "ok"; },
    attachOrder: async () => true, markFailed: async (_id, r) => { log.failed = r; }, ...o,
  };
  return { d, log };
}
const input = { tenantId: "t1", source: "public_booking" as const, idempotencyKey: "booking:apt-123", amountCents: 2500, description: "Aanbetaling", successUrl: "https://glowsuite.nl/s", failureUrl: "https://glowsuite.nl/f", refs: { appointment_id: "apt-123" } };

describe("LIVE deposit start", () => {
  it("off by default: no network, no write", async () => {
    const { d, log } = depDeps({ enabled: undefined });
    expect(await startLiveDeposit(input, d)).toMatchObject({ ok: false, reason: "live_isv_checkout_disabled" });
    expect(log.inserted).toBeNull();
  });
  it("salon merchant, Default source, per-salon fee in cents included in amount, snapshot written", async () => {
    const { d, log } = depDeps();
    const r = await startLiveDeposit(input, d);
    expect(r).toMatchObject({ ok: true, checkoutUrl: "https://www.vivapayments.com/web/checkout?ref=1234567890123456" });
    expect(log.posts[0].u).toContain(`merchantId=${MID}`);
    expect(log.posts[0].body).toMatchObject({ amount: 2500, isvAmount: 50, sourceCode: "Default" });
    expect(log.inserted.s).toMatchObject({ fee_cents: 50, amount_cents: 2500, environment: "live" });
  });
  it("retry reuses pending order, no second Viva order", async () => {
    const { d, log } = depDeps({ findExisting: async () => ({ id: "p0", checkout_url: "u", status: "pending" }) });
    expect(await startLiveDeposit(input, d)).toMatchObject({ ok: true, reused: true });
    expect(log.posts).toHaveLength(0);
  });
  it("KYC pending, missing merchant, missing fee config = no charge", async () => {
    expect(await startLiveDeposit(input, depDeps({ retrieve: async () => ({ ...acc, verified: false }) }).d)).toMatchObject({ reason: "kyc_not_verified" });
    expect(await startLiveDeposit(input, depDeps({ loadMerchant: async () => null }).d)).toMatchObject({ reason: "merchant_unclear" });
    expect(await startLiveDeposit(input, depDeps({ feeConfig: async () => null }).d)).toMatchObject({ reason: "fee_config_unavailable" });
  });
  it("unclear Viva response marks payment failed", async () => {
    const { d, log } = depDeps({ fetch: (async (u: string) => new Response(u.includes("token") ? JSON.stringify({ access_token: "t" }) : "x", { status: u.includes("token") ? 200 : 500 })) as any });
    expect(await startLiveDeposit(input, d)).toMatchObject({ reason: "order_unclear" });
    expect(log.failed).toBe("order_unclear");
  });
});

function whDeps(tx: any, o: Partial<WebhookDeps> = {}, status = "pending") {
  const log: any = { paid: null, failed: null, refund: null };
  const d: WebhookDeps = {
    env, enabled: true,
    fetch: (async (u: string) => new Response(JSON.stringify(u.includes("token") ? { access_token: "t" } : tx), { status: tx || u.includes("token") ? 200 : 500 })) as any,
    findByOrderCode: async () => ({ id: "p1", user_id: "t1", status, is_demo: false, provider: "viva", amount: 25, metadata: { route: "viva_isv_live", viva_merchant_id: MID, viva_order_code: "1234567890", viva_transaction_id: TX } }),
    loadVerifiedMerchant: async () => ({ user_id: "t1", viva_merchant_id: MID, verified: true }),
    loadSnapshot: async () => ({ amount_cents: 2500, fee_cents: 50 }),
    markPaid: async (_i, r) => { log.paid = r; return true; },
    markFailedIfPending: async (_i, r) => { log.failed = r; },
    recordRefund: async (_i, t, c, f) => { log.refund = { c, f }; return "ok"; }, ...o,
  };
  return { d, log };
}
const ev = { OrderCode: "1234567890", TransactionId: TX, MerchantId: MID };
const okTx = { statusId: "F", amount: 25, currencyCode: "978", orderCode: 1234567890, merchantId: MID };

describe("LIVE payment webhooks", () => {
  it("1796 paid only after Viva F + all matches", async () => {
    const { d, log } = whDeps(okTx);
    expect(await handleLivePaymentEvent(1796, ev, d, "now")).toEqual({ status: 200, note: "paid" });
    expect(log.paid.verified_via).toBe("viva_isv_live_api");
  });
  it("1796 pending status or amount mismatch = not paid", async () => {
    expect((await handleLivePaymentEvent(1796, ev, whDeps({ ...okTx, statusId: "A" }).d, "now")).note).toBe("hold_viva_status_A");
    expect((await handleLivePaymentEvent(1796, ev, whDeps({ ...okTx, amount: 1 }).d, "now")).note).toBe("hold_amount_mismatch");
  });
  it("1796 lookup failure = retry (503), duplicate after paid = no change", async () => {
    expect(await handleLivePaymentEvent(1796, ev, whDeps(null).d, "now")).toEqual({ status: 503, note: "retry_unverified" });
    const { d, log } = whDeps(okTx, {}, "paid");
    expect((await handleLivePaymentEvent(1796, ev, d, "now")).note).toBe("hold_status_paid");
    expect(log.paid).toBeNull();
  });
  it("other salon's merchant is held", async () => {
    const { d } = whDeps(okTx, { loadVerifiedMerchant: async () => ({ user_id: "t2", viva_merchant_id: MID, verified: true }) });
    expect((await handleLivePaymentEvent(1796, ev, d, "now")).note).toBe("merchant_hold");
  });
  it("1798 marks failed only when Viva confirms non-F", async () => {
    const { d, log } = whDeps({ ...okTx, statusId: "E" });
    await handleLivePaymentEvent(1798, ev, d, "now");
    expect(log.failed).toBe("viva_E");
  });
  it("1797 partial refund returns fee proportionally", async () => {
    const { d, log } = whDeps({ ...okTx, amount: -12.5, parentId: TX }, {}, "paid");
    expect((await handleLivePaymentEvent(1797, ev, d, "now")).note).toBe("refund_recorded");
    expect(log.refund).toEqual({ c: 1250, f: 25 });
  });
  it("switch off = ignored, no lookup", async () => {
    let called = false;
    const { d } = whDeps(okTx, { enabled: undefined, findByOrderCode: async () => { called = true; return null; } });
    expect((await handleLivePaymentEvent(1796, ev, d, "now")).note).toBe("live_disabled");
    expect(called).toBe(false);
  });
});
