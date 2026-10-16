import { describe, it, expect } from "vitest";
import { fetchLiveIsvTransaction, parseLiveTransaction } from "../../supabase/functions/_shared/inactive/isvLiveConfirm.ts";
import { handleLivePaymentEvent, type WebhookDeps } from "../../supabase/functions/_shared/inactive/isvLivePayments.ts";
const MID = "11111111-2222-3333-4444-555555555555";
const TX = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const env = (n: string) => ({ VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_LIVE_CLIENT_ID: "test-id", VIVA_ISV_LIVE_CLIENT_SECRET: "test-secret" } as Record<string, string>)[n];
const tx = { transactionId: TX, statusId: "F", amount: 25, currencyCode: "978", orderCode: "1234567890", merchantId: MID };
const lookup = async (body: unknown) => parseLiveTransaction(body, TX, { amountUnit: "major" });
describe("prepared parser safety, not provider unit evidence", () => {
  it.each([null, "", false, true, "25", [], {}])("rejects malformed amount %j", async (amount) => {
    expect(await lookup({ ...tx, amount })).toBeNull();
  });
  it.each([1.005, -1.005, Number.MAX_SAFE_INTEGER])("does not invent rounding for %s", async (amount) => {
    expect(await lookup({ ...tx, amount })).toBeNull();
  });
  it.each([[12.5, 1250], [-12.5, -1250], [0.29, 29], [-0.29, -29]])("preserves exact assumed cents %s", async (amount, amountCents) => {
    expect(await lookup({ ...tx, amount })).toMatchObject({ amountCents });
  });
  it("rejects returned transaction ID mismatch", async () => {
    expect(await lookup({ ...tx, transactionId: MID })).toBeNull();
  });
  it("accepts identical UUID with case differences", async () => {
    expect(await lookup({ ...tx, transactionId: TX.toUpperCase() })).toMatchObject({ amountCents: 2500 });
  });
});
describe("untrusted event never proves a payment", () => {
  function deps(response: unknown) {
    const writes: string[] = [];
    const d: WebhookDeps = {
      env, enabled: true, transactionContract: { amountUnit: "major" },
      fetch: async (url, init) => {
        if (!url.includes("token")) expect(init?.headers).toMatchObject({ Authorization: "Bearer test-token" });
        return new Response(JSON.stringify(url.includes("token") ? { access_token: "test-token" } : response));
      },
      findByOrderCode: async () => ({ id: "p", user_id: "t", status: "pending", provider: "viva", is_demo: false, amount: 25, metadata: { route: "viva_isv_live", viva_merchant_id: MID, viva_order_code: "1234567890" } }),
      loadVerifiedMerchant: async () => ({ user_id: "t", viva_merchant_id: MID, verified: true }),
      loadSnapshot: async () => ({ amount_cents: 2500, fee_cents: 35 }),
      markPaid: async () => { writes.push("paid"); return true; },
      markFailedIfPending: async () => { writes.push("failed"); },
      recordRefund: async () => { writes.push("refund"); return "ok"; },
    };
    return { d, writes };
  }
  it.each([{ amount: 1 }, { currencyCode: "840" }, { orderCode: "999" }, { merchantId: TX }, { statusId: "A" }])("holds API mismatch %j despite claimed F and Amount", async (override) => {
    const { d, writes } = deps({ ...tx, ...override });
    await handleLivePaymentEvent(1796, { OrderCode: "1234567890", TransactionId: TX, MerchantId: MID, StatusId: "F", Amount: 2500 }, d, "now");
    expect(writes).toEqual([]);
  });
  it("off means no lookup or write for an untrusted POST", async () => {
    const { d, writes } = deps(tx);
    d.enabled = undefined;
    d.findByOrderCode = async () => { throw new Error("unexpected read"); };
    d.fetch = async () => { throw new Error("unexpected network"); };
    expect(await handleLivePaymentEvent(1796, { OrderCode: "1234567890", TransactionId: TX }, d, "now")).toEqual({ status: 200, note: "live_disabled" });
    expect(writes).toEqual([]);
  });
});
