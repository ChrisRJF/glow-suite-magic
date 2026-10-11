import { describe, it, expect } from "vitest";
import { liveKycReady, environmentMatches, isInternalCheckoutCall, isCheckoutPayment, type MerchantKyc } from "../../supabase/functions/_shared/checkoutGuard";

const ok: MerchantKyc = { is_demo: false, viva_merchant_id: "m1", viva_source_code: "1234", onboarding_status: "active",
  kyc_status: "verified", setup_complete: true, terminals_enabled: true, online_payments_enabled: true };

describe("live KYC gate", () => {
  it("allows a fully verified merchant", () => { expect(liveKycReady(ok, "terminal")).toBe(true); expect(liveKycReady(ok, "link")).toBe(true); });
  it("blocks a missing merchant", () => expect(liveKycReady(null, "terminal")).toBe(false));
  it("blocks pending KYC", () => expect(liveKycReady({ ...ok, kyc_status: "pending" }, "link")).toBe(false));
  it("blocks unknown KYC", () => expect(liveKycReady({ ...ok, kyc_status: null }, "link")).toBe(false));
  it("blocks unfinished onboarding", () => expect(liveKycReady({ ...ok, onboarding_status: "pending" }, "terminal")).toBe(false));
  it("blocks incomplete setup", () => expect(liveKycReady({ ...ok, setup_complete: null }, "terminal")).toBe(false));
  it("blocks terminal when terminal capability is off", () => expect(liveKycReady({ ...ok, terminals_enabled: false }, "terminal")).toBe(false));
  it("blocks link when online capability is unknown", () => expect(liveKycReady({ ...ok, online_payments_enabled: null }, "link")).toBe(false));
  it("blocks a demo merchant row for live", () => expect(liveKycReady({ ...ok, is_demo: true }, "terminal")).toBe(false));
  it("blocks a missing source code", () => expect(liveKycReady({ ...ok, viva_source_code: " " }, "link")).toBe(false));
});

describe("demo and live stay separated", () => {
  it("demo salon may use demo environment", () => expect(environmentMatches(true, "demo")).toBe(true));
  it("demo salon may never use live environment", () => expect(environmentMatches(true, "LIVE")).toBe(false));
  it("live salon may not use demo environment", () => expect(environmentMatches(false, undefined)).toBe(false));
  it("live salon uses live environment", () => expect(environmentMatches(false, "live")).toBe(true));
});

describe("internal checkout call", () => {
  const req = (h?: string) => new Request("http://x", { headers: h ? { "x-glowsuite-checkout": h } : {} });
  it("accepts only the server key", () => expect(isInternalCheckoutCall(req("secret-key"), "secret-key")).toBe(true));
  it("rejects a browser without header", () => expect(isInternalCheckoutCall(req(), "secret-key")).toBe(false));
  it("rejects a wrong value", () => expect(isInternalCheckoutCall(req("secret-kez"), "secret-key")).toBe(false));
  it("rejects when the server key is missing", () => expect(isInternalCheckoutCall(req(""), "")).toBe(false));
});

describe("only marked checkout payments use the ledger", () => {
  it("old payments are not checkout payments", () => { expect(isCheckoutPayment({ source: "public_booking" })).toBe(false); expect(isCheckoutPayment(null)).toBe(false); });
  it("marked payments are", () => expect(isCheckoutPayment({ checkout: "appointment_checkout" })).toBe(true));
});
