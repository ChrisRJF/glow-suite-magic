import { describe, it, expect } from "vitest";
import {
  deriveCapabilities, prepareLiveIsvOrder, customerPaymentProvider, authorizeAutoRevenue, LIVE_ISV_CHECKOUT_ENABLED,
} from "../../supabase/functions/_shared/inactive/isvLiveCheckout.ts";

const MID = "11111111-2222-3333-4444-555555555555";
const row = { id: "r", user_id: "t1", is_demo: false, viva_account_id: "acc-12345678", viva_merchant_id: MID, viva_source_code: "5555", onboarding_status: "active", kyc_status: "verified" };
const acc = { accountId: "acc-12345678", merchantId: MID, verified: true as boolean | null };
const order = (o: any = {}) => prepareLiveIsvOrder({ tenantId: "t1", row, caps: deriveCapabilities(row, acc), amountCents: 2500, description: "Aanbetaling", successUrl: "https://glowsuite.nl/s", failureUrl: "https://glowsuite.nl/f", enabled: true, ...o });

describe("LIVE ISV capabilities (Retrieve only)", () => {
  it("verified + matching merchant + source code = enabled", () => expect(deriveCapabilities(row, acc).online_payments_enabled).toBe(true));
  it("KYC pending or unknown = off", () => {
    expect(deriveCapabilities(row, { ...acc, verified: false }).reason).toBe("kyc_not_verified");
    expect(deriveCapabilities(row, { ...acc, verified: null }).online_payments_enabled).toBe(false);
  });
  it("revoked after being active = off (idempotent)", () => {
    const a = deriveCapabilities(row, { ...acc, verified: false });
    expect(a).toEqual(deriveCapabilities(row, { ...acc, verified: false }));
    expect(a.terminals_enabled).toBe(false);
  });
  it("Retrieve failure = off", () => expect(deriveCapabilities(row, null).reason).toBe("retrieve_unavailable"));
  it("wrong merchant = off", () => expect(deriveCapabilities(row, { ...acc, merchantId: "99999999-2222-3333-4444-555555555555" }).reason).toBe("merchant_mismatch"));
  it("online uses Viva's Default web source; terminals need the salon's own physical source", () => {
    const c = deriveCapabilities({ ...row, viva_source_code: null }, acc);
    expect(c.online_payments_enabled).toBe(true);
    expect(c.terminals_enabled).toBe(false);
    expect(deriveCapabilities({ ...row, viva_source_code: "1234" }, acc).terminals_enabled).toBe(false);
  });
  it("demo merchant row = off", () => expect(deriveCapabilities({ ...row, is_demo: true }, acc).online_payments_enabled).toBe(false));
});

describe("LIVE ISV order builder", () => {
  it("is disabled in production", () => {
    expect(LIVE_ISV_CHECKOUT_ENABLED).toBe(false);
    expect(order({ enabled: undefined })).toEqual({ ok: false, error: "live_isv_checkout_disabled" });
  });
  it("routes to the salon's own merchant and source code", () => {
    const o = order();
    expect(o.ok).toBe(true);
    if (o.ok) {
      expect(o.url).toBe(`https://api.vivapayments.com/checkout/v2/isv/orders?merchantId=${MID}`);
      expect(o.body.sourceCode).toBe("Default");
      expect(o.url).not.toMatch(/checkout\/v2\/orders/);
    }
  });
  it("blocks other tenant, disabled capability and bad amount", () => {
    expect(order({ tenantId: "t2" })).toEqual({ ok: false, error: "merchant_not_salon" });
    expect(order({ caps: deriveCapabilities(row, { ...acc, verified: false }) })).toEqual({ ok: false, error: "kyc_not_verified" });
    expect(order({ amountCents: 0 })).toEqual({ ok: false, error: "invalid_amount_cents" });
  });
});

describe("customer payment provider", () => {
  it("Mollie and unknown are denied", () => {
    expect(customerPaymentProvider("mollie")).toBe("deny");
    expect(customerPaymentProvider(null)).toBe("deny");
    expect(customerPaymentProvider("viva")).toBe("viva_isv");
  });
});

describe("auto-revenue authorization", () => {
  const ok = { isServiceRole: false, authUserId: "u", memberTenantId: "t1", memberRole: "eigenaar", bodyUserId: "t1", appointmentOwnerId: "t1", offerOwnerId: "t1" };
  it("owner of the tenant passes", () => expect(authorizeAutoRevenue(ok)).toEqual({ ok: true, tenantId: "t1" }));
  it("anonymous caller is refused", () => expect(authorizeAutoRevenue({ ...ok, authUserId: null, memberTenantId: null }).ok).toBe(false));
  it("forged tenant in body is refused", () => expect(authorizeAutoRevenue({ ...ok, bodyUserId: "t2" })).toMatchObject({ status: 403 }));
  it("employee role is refused", () => expect(authorizeAutoRevenue({ ...ok, memberRole: "medewerker" }).ok).toBe(false));
  it("appointment of another salon is refused", () => expect(authorizeAutoRevenue({ ...ok, appointmentOwnerId: "t2" })).toMatchObject({ reason: "cross_tenant" }));
  it("service role still needs matching rows", () => expect(authorizeAutoRevenue({ ...ok, isServiceRole: true, authUserId: null, offerOwnerId: "x" }).ok).toBe(false));
});
