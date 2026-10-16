import { describe, it, expect } from "vitest";
import { evaluateLiveConfirmation as ev, fetchLiveIsvTransaction, type LiveConfirmInput } from "../../supabase/functions/_shared/inactive/isvLiveConfirm.ts";

const MID = "11111111-2222-3333-4444-555555555555";
const TX = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const base = (o: Partial<LiveConfirmInput> = {}): LiveConfirmInput => ({
  payment: { id: "p", user_id: "t1", status: "pending", is_demo: false, provider: "viva", amount: 25, metadata: { route: "viva_isv_live", viva_merchant_id: MID, viva_order_code: "123" } },
  merchant: { user_id: "t1", viva_merchant_id: MID, verified: true },
  eventMerchantId: MID, transactionId: TX,
  tx: { statusId: "F", amountCents: 2500, currencyCode: "978", orderCode: "123", merchantId: MID }, ...o,
});
const reason = (o: Partial<LiveConfirmInput>) => { const r = ev(base(o), "now"); return r.ok ? "ok" : r.reason; };

describe("LIVE ISV confirmation", () => {
  it("confirmed Viva result for the salon's own merchant = paid", () => expect(ev(base(), "now").ok).toBe(true));
  it("pending/other Viva status never paid", () => expect(reason({ tx: { ...(base().tx ?? { statusId: "F", amountCents: 2500, currencyCode: "978", orderCode: "123", merchantId: MID }), statusId: "A" } })).toBe("viva_status_A"));
  it("lookup error never paid", () => expect(reason({ tx: null })).toBe("viva_unverified"));
  it("duplicate webhook after paid is refused", () => expect(reason({ payment: { ...base().payment, status: "paid" } })).toBe("status_paid"));
  it("unverified or other salon's merchant refused", () => {
    expect(reason({ merchant: { user_id: "t1", viva_merchant_id: MID, verified: false } })).toBe("merchant_not_verified_for_salon");
    expect(reason({ merchant: { user_id: "t2", viva_merchant_id: MID, verified: true } })).toBe("merchant_not_verified_for_salon");
  });
  it("merchant, order, amount, currency mismatches refused", () => {
    expect(reason({ eventMerchantId: "x" })).toBe("event_merchant_mismatch");
    expect(reason({ tx: { ...(base().tx ?? { statusId: "F", amountCents: 2500, currencyCode: "978", orderCode: "123", merchantId: MID }), merchantId: "other" } })).toBe("viva_merchant_mismatch");
    expect(reason({ tx: { ...(base().tx ?? { statusId: "F", amountCents: 2500, currencyCode: "978", orderCode: "123", merchantId: MID }), orderCode: "999" } })).toBe("order_code_mismatch");
    expect(reason({ tx: { ...(base().tx ?? { statusId: "F", amountCents: 2500, currencyCode: "978", orderCode: "123", merchantId: MID }), amountCents: 100 } })).toBe("amount_mismatch");
    expect(reason({ tx: { ...(base().tx ?? { statusId: "F", amountCents: 2500, currencyCode: "978", orderCode: "123", merchantId: MID }), currencyCode: "840" } })).toBe("currency_mismatch");
  });
  it("demo, platform or non-ISV payments refused", () => {
    expect(reason({ payment: { ...base().payment, is_demo: true } })).toBe("not_live_isv_payment");
    expect(reason({ payment: { ...base().payment, metadata: { viva_merchant_id: MID, viva_order_code: "123" } } })).toBe("not_live_isv_payment");
  });
});

describe("LIVE ISV lookup (mock fetch, no network)", () => {
  const env = (n: string) => ({ VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_LIVE_CLIENT_ID: "id", VIVA_ISV_LIVE_CLIENT_SECRET: "s" } as Record<string, string>)[n];
  it("uses LIVE ISV token and merchant-scoped URL", async () => {
    const urls: string[] = [];
    const f = async (u: string) => { urls.push(u); return new Response(JSON.stringify(u.includes("token") ? { access_token: "t" } : { transactionId: TX, merchantId: MID, statusId: "F", amount: 25, currencyCode: "978", orderCode: 123 }), { status: 200 }); };
    const tx = await fetchLiveIsvTransaction(env, MID, TX, f as any, { amountUnit: "major" });
    expect(urls[0]).toBe("https://accounts.vivapayments.com/connect/token");
    expect(urls[1]).toBe(`https://api.vivapayments.com/checkout/v2/isv/transactions/${TX}?merchantId=${MID}`);
    expect(tx).toEqual({ statusId: "F", amountCents: 2500, currencyCode: "978", orderCode: "123", merchantId: MID, parentId: null });
  });
  it("switch off = no network call", async () => {
    let called = false;
    expect(await fetchLiveIsvTransaction(() => undefined, MID, TX, (async () => { called = true; return new Response("{}"); }) as any)).toBeNull();
    expect(called).toBe(false);
  });
  it("HTTP error = null", async () => {
    const f = async (u: string) => new Response(JSON.stringify({ access_token: "t" }), { status: u.includes("token") ? 200 : 404 });
    expect(await fetchLiveIsvTransaction(env, MID, TX, f as any, { amountUnit: "major" })).toBeNull();
  });
});
