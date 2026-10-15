import { describe, it, expect } from "vitest";
import {
  buildCreatePayload, safeInvitationUrl, parseCreateV2, parseRetrieveV2, decideCreateV2,
  deriveUpdateV2, livePaymentAllowedV2, wizardStatus, isvHost, retrieveV2, GLOWPAY_LOGO_URL,
} from "../../supabase/functions/_shared/inactive/isvOnboardingV2";
import type { MerchantRow } from "../../supabase/functions/_shared/inactive/isvOnboardingSafety";

const ACC = "11111111-aaaa-4aaa-8aaa-111111111111";
const MID = "aaaaaaaa-0000-4000-8000-00000000000a";
const row = (o: Partial<MerchantRow> = {}): MerchantRow => ({ id: "r", user_id: "salon-a", is_demo: false, viva_account_id: ACC,
  viva_merchant_id: null, viva_source_code: null, onboarding_status: "invited", kyc_status: null,
  onboarding_url: "https://demo.vivapayments.com/onboarding/x", ...o });
const acc = (o: any = {}) => ({ accountId: ACC, verified: true, acquiringEnabled: true, merchantId: MID, ...o });
const brand = (c: string | null = "#1A7F5A") => ({ partnerName: "GlowPay", logoUrl: GLOWPAY_LOGO_URL, primaryColor: c });

describe("create payload", () => {
  it("valid", () => expect(buildCreatePayload({ email: "a@test.example", returnUrl: "https://glowsuite.nl/glowpay", branding: brand() })?.branding.partnerName).toBe("GlowPay"));
  it("missing brand colour refuses (no invented green)", () => expect(buildCreatePayload({ email: "a@test.example", returnUrl: "https://glowsuite.nl/x", branding: brand(null) })).toBeNull());
  it("foreign returnUrl refuses", () => expect(buildCreatePayload({ email: "a@test.example", returnUrl: "https://evil.example", branding: brand() })).toBeNull());
});

describe("invitation url", () => {
  it("accepts Viva https", () => expect(safeInvitationUrl("https://demo.vivapayments.com/a")).toBeTruthy());
  it("rejects http / foreign / js", () => ["http://demo.vivapayments.com", "https://vivapayments.com.evil.io", "javascript:alert(1)"].forEach((u) => expect(safeInvitationUrl(u)).toBeNull()));
  it("parses invitation.redirectUrl only", () => {
    expect(parseCreateV2({ accountId: ACC, invitation: { redirectUrl: "https://demo.vivapayments.com/i" } })).not.toBeNull();
    expect(parseCreateV2({ accountId: ACC, redirectUrl: "https://demo.vivapayments.com/i" })).toBeNull();
  });
});

describe("retrieve parse", () => {
  it("strict booleans", () => expect(parseRetrieveV2(ACC, { verified: "true", acquiringEnabled: true })).toBeNull());
  it("empty merchantId -> null", () => expect(parseRetrieveV2(ACC, { verified: false, acquiringEnabled: false, merchantId: "" })?.merchantId).toBeNull());
  it("other account rejected", () => expect(parseRetrieveV2(ACC, { accountId: "x", verified: true, acquiringEnabled: true })).toBeNull());
  it("Viva down -> null", async () => expect(await retrieveV2(ACC, "demo", "t", async () => new Response("", { status: 500 }))).toBeNull());
  it("no ISV token -> null", async () => expect(await retrieveV2(ACC, "demo", null, async () => new Response("{}"))).toBeNull());
});

describe("idempotent create + env isolation", () => {
  it("no row -> create", () => expect(decideCreateV2(null, "demo").action).toBe("create"));
  it("repeat -> reuse link", () => expect(decideCreateV2(row({ is_demo: true }), "demo")).toEqual({ action: "reuse", redirectUrl: "https://demo.vivapayments.com/onboarding/x" }));
  it("unsafe stored link -> refresh, never recreate", () => expect(decideCreateV2(row({ is_demo: true, onboarding_url: "http://x" }), "demo").action).toBe("refresh_invite"));
  it("live row under demo env refused", () => expect(decideCreateV2(row(), "demo")).toEqual({ action: "refuse", reason: "env_mismatch" }));
  it("rejected -> manual review", () => expect(decideCreateV2(row({ is_demo: true, onboarding_status: "rejected" }), "demo").action).toBe("refuse"));
  it("unknown env -> no host", () => expect(isvHost(undefined)).toBeNull());
});

describe("status derivation", () => {
  it("verified but acquiring off stays pending", () => expect(deriveUpdateV2(row(), acc({ acquiringEnabled: false }))?.onboarding_status).toBe("kyc_pending"));
  it("not verified -> invited/pending", () => expect(deriveUpdateV2(row(), acc({ verified: false, merchantId: null }))?.onboarding_status).toBe("invited"));
  it("never sets source code", () => expect(deriveUpdateV2(row(), acc())).not.toHaveProperty("viva_source_code"));
  it("never rebinds merchant", () => expect(deriveUpdateV2(row({ viva_merchant_id: "bbbbbbbb-0000-4000-8000-00000000000b" }), acc())).toBeNull());
});

describe("live payment gate", () => {
  const full = row({ viva_merchant_id: MID, viva_source_code: "1234", onboarding_status: "active" });
  it("ok only when all confirmed", () => expect(livePaymentAllowedV2(full, acc(), "live").ok).toBe(true));
  it("demo env blocks", () => expect(livePaymentAllowedV2(full, acc(), "demo").reason).toBe("not_live_env"));
  it("KYC pending blocks", () => expect(livePaymentAllowedV2(full, acc({ verified: false }), "live").reason).toBe("kyc_not_verified"));
  it("acquiring off blocks", () => expect(livePaymentAllowedV2(full, acc({ acquiringEnabled: false }), "live").reason).toBe("acquiring_disabled"));
  it("source code missing blocks", () => expect(livePaymentAllowedV2({ ...full, viva_source_code: null }, acc(), "live").reason).toBe("source_code_missing"));
  it("Viva unavailable blocks", () => expect(livePaymentAllowedV2(full, null, "live").ok).toBe(false));
});

describe("wizard status", () => {
  it("booking active, payments not started", () => expect(wizardStatus(null, "slug")).toEqual({ booking: "active", payments: "not_started" }));
  it("active without source code stays pending", () => expect(wizardStatus(row({ onboarding_status: "active" }), "s").payments).toBe("pending"));
  it("rejected -> action needed", () => expect(wizardStatus(row({ onboarding_status: "rejected" }), "s").payments).toBe("action_needed"));
});
