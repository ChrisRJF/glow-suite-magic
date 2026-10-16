import { describe, it, expect, vi } from "vitest";
import { LIVE_TRANSACTION_CONTRACT, fetchLiveIsvTransaction, parseLiveTransaction } from "../../supabase/functions/_shared/inactive/isvLiveConfirm.ts";
import { handleLivePaymentEvent, type WebhookDeps } from "../../supabase/functions/_shared/inactive/isvLivePayments.ts";
import { liveEventProcessed } from "../../supabase/functions/_shared/inactive/isvLiveRouting.ts";

const MID = "11111111-2222-3333-4444-555555555555";
const TX = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const response = { transactionId: TX, merchantId: MID, statusId: "F", amount: 2.50, currencyCode: 978, orderCode: 1234567890 };
const env = (n: string) => ({ VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_LIVE_CLIENT_ID: "fixture-id", VIVA_ISV_LIVE_CLIENT_SECRET: "fixture-secret" } as Record<string, string>)[n];

describe("written Viva partner sale contract", () => {
  it("production contract is major, 2.50 EUR equals 250 cents", () => {
    expect(LIVE_TRANSACTION_CONTRACT).toEqual({ amountUnit: "major" });
    expect(parseLiveTransaction(response, TX, LIVE_TRANSACTION_CONTRACT)?.amountCents).toBe(250);
  });
  it("default lookup uses the confirmed LIVE merchant-scoped route and major units", async () => {
    const calls: string[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.endsWith("/connect/token")) return new Response(JSON.stringify({ access_token: "fixture-token" }));
      expect(init?.headers).toMatchObject({ Authorization: "Bearer fixture-token" });
      return new Response(JSON.stringify(response));
    };
    expect((await fetchLiveIsvTransaction(env, MID, TX, fetcher))?.amountCents).toBe(250);
    expect(calls).toEqual(["https://accounts.vivapayments.com/connect/token", `https://api.vivapayments.com/checkout/v2/isv/transactions/${TX}?merchantId=${MID}`]);
  });
  it.each([[0.29, 29], [0.07, 7], [2.50, 250], [12.50, 1250]])("preserves decimal precision for %s EUR", (amount, cents) => {
    expect(parseLiveTransaction({ ...response, amount }, TX, LIVE_TRANSACTION_CONTRACT)?.amountCents).toBe(cents);
  });
  it.each([1.005, 2.501, 0.001, NaN, Infinity, Number.MAX_SAFE_INTEGER, "2.50", null, true, {}, []])("rejects invalid or subcent amount %j without rounding", (amount) => {
    expect(parseLiveTransaction({ ...response, amount }, TX, LIVE_TRANSACTION_CONTRACT)).toBeNull();
  });
  it.each([{ transactionId: MID }, { transactionId: undefined }, { merchantId: null }, { statusId: 1 }, { currencyCode: {} }, { orderCode: 1.5 }])("rejects malformed response %j", (fields) => {
    expect(parseLiveTransaction({ ...response, ...fields }, TX, LIVE_TRANSACTION_CONTRACT)).toBeNull();
  });
});

describe("unproven reversal semantics remain a separate production hold", () => {
  it.each([
    { amount: -2.50, parentId: TX, statusId: "F" },
    { amount: 2.50, parentId: TX, statusId: "F" },
    { amount: -2.50, originalTransactionId: TX, statusId: "F" },
    { amount: -2.50, parentId: TX, statusId: "R" },
  ])("never refunds based on an assumed shape %j", async (fields) => {
    const forbidden = vi.fn(async () => { throw new Error("no lookup or write allowed"); });
    const deps: WebhookDeps = {
      env, enabled: true, transactionContract: { amountUnit: "major" }, fetch: forbidden,
      findByOrderCode: forbidden, findByTransactionId: forbidden, loadVerifiedMerchant: forbidden,
      loadSnapshot: forbidden, markPaid: forbidden, markFailedIfPending: forbidden, recordRefund: forbidden,
    };
    const result = await handleLivePaymentEvent(1797, { TransactionId: TX, MerchantId: MID, ...fields }, deps, "now");
    expect(result).toEqual({ status: 503, note: "refund_contract_unverified_hold" });
    expect(forbidden).not.toHaveBeenCalled();
    expect(liveEventProcessed(result)).toBe(false);
  });
});