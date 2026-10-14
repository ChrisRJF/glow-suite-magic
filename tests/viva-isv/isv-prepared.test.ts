import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  onlineIsvFeeCents, terminalIsvFeeCents, isvFeeOwedCents, resolvePlatformFeeCents,
  prepareTerminalIsvSale, prepareOnlineIsvOrder, isvCredentials,
} from "../../supabase/functions/_shared/vivaIsvPrepared";

const env = { VIVA_ISV_DEMO_ENABLED: "true", VIVA_ENVIRONMENT: "demo", VIVA_ISV_CLIENT_ID: "synthetic-id", VIVA_ISV_CLIENT_SECRET: "synthetic-secret" };
const merchant = { is_demo: true, onboarding_status: "connected", viva_merchant_id: "synthetic-merchant", viva_source_code: "synthetic-src", terminals_enabled: true };
const terminal = { terminal_id: "synthetic-terminal", is_demo: true, merchant_id: "synthetic-merchant" };
const sale = (o: Record<string, unknown> = {}) => prepareTerminalIsvSale({ env, merchant, terminal, amountCents: 10000, sessionId: "s", cashRegisterId: "c", merchantReference: "r", ...o } as any);

describe("ISV fees", () => {
  it("online € 100 -> € 0,35", () => expect(onlineIsvFeeCents(10000)).toBe(35));
  it("terminal € 100 -> € 1,50", () => expect(terminalIsvFeeCents(10000)).toBe(150));
  it("terminal € 25 -> € 0,38 (0,375 half-up)", () => expect(terminalIsvFeeCents(2500)).toBe(38));
  it("fee never exceeds amount", () => { expect(onlineIsvFeeCents(20)).toBe(20); expect(terminalIsvFeeCents(1)).toBeLessThanOrEqual(1); });
  it("no fee for failed or cancelled", () => { expect(isvFeeOwedCents("E", 150)).toBe(0); expect(isvFeeOwedCents("X", 150)).toBe(0); expect(isvFeeOwedCents("F", 150)).toBe(150); });
  it("ISV fee replaces legacy margin, stored fee never recounted", () => {
    expect(resolvePlatformFeeCents({ isv_fee_cents: 150 }, 30)).toEqual({ cents: 150, alreadyStored: false });
    expect(resolvePlatformFeeCents({ platform_fee_cents: 150, isv_fee_cents: 150 }, 30)).toEqual({ cents: 150, alreadyStored: true });
  });
});

describe("terminal ISV request", () => {
  it("builds isvDetails from server-side merchant", () => {
    const r = sale(); if (!r.ok) throw new Error(r.error);
    expect(r.url).toBe("/ecr/isv/v1/transactions:sale");
    expect(r.body.isvDetails).toEqual({ amount: 150, terminalMerchantId: "synthetic-merchant", currencyCode: 978 });
    expect(r.body.amount).toBe(10000);
  });
  it("missing ISV credentials, no fallback to merchant credentials", () => {
    const e = { VIVA_ISV_DEMO_ENABLED: "true", VIVA_CLIENT_ID: "merchant-id", VIVA_CLIENT_SECRET: "merchant-secret" };
    expect(isvCredentials(e)).toBeNull();
    expect(sale({ env: e })).toEqual({ ok: false, error: "isv_credentials_missing" });
  });
  it("flag off by default", () => expect(sale({ env: { ...env, VIVA_ISV_DEMO_ENABLED: undefined } })).toEqual({ ok: false, error: "isv_demo_disabled" }));
  it("rejects missing or wrong merchant link", () => {
    expect(sale({ merchant: null })).toEqual({ ok: false, error: "merchant_not_connected" });
    expect(sale({ merchant: { ...merchant, is_demo: false } })).toEqual({ ok: false, error: "merchant_not_demo" });
    expect(sale({ merchant: { ...merchant, viva_merchant_id: null } })).toEqual({ ok: false, error: "merchant_id_missing" });
    expect(sale({ terminal: { ...terminal, merchant_id: "other" } })).toEqual({ ok: false, error: "terminal_merchant_mismatch" });
    expect(sale({ terminal: null })).toEqual({ ok: false, error: "terminal_missing" });
  });
});

describe("online ISV order", () => {
  it("merchantId in query, isvAmount included in amount", () => {
    const r = prepareOnlineIsvOrder({ env, merchant, amountCents: 10000, description: "Demo" }); if (!r.ok) throw new Error(r.error);
    expect(r.url).toBe("/checkout/v2/isv/orders");
    expect(r.query).toEqual({ merchantId: "synthetic-merchant" });
    expect(r.body.merchantId).toBeUndefined();
    expect(r.body.amount).toBe(10000);
    expect(r.body.isvAmount).toBe(35);
  });
  it("requires merchant source code", () =>
    expect(prepareOnlineIsvOrder({ env, merchant: { ...merchant, viva_source_code: "" }, amountCents: 10000, description: "x" })).toEqual({ ok: false, error: "merchant_source_code_missing" }));
});

describe("existing routes untouched", () => {
  it("no entrypoint imports the prepared module", () => {
    for (const f of ["create-viva-terminal-payment", "create-viva-payment", "viva-webhook"]) {
      expect(readFileSync(`supabase/functions/${f}/index.ts`, "utf8")).not.toContain("vivaIsvPrepared");
    }
    const term = readFileSync("supabase/functions/create-viva-terminal-payment/index.ts", "utf8");
    expect(term).toContain("/ecr/v1/transactions:sale");
    expect(term).not.toContain("/ecr/isv/");
  });
});
