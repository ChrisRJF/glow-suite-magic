import { describe, it, expect } from "vitest";
import { registrationAction, kycLabel, onboardingLabel } from "@/lib/glowpayMerchantView";

describe("GlowPay registratieactie", () => {
  it("geen account = start", () => {
    expect(registrationAction(null)).toEqual({ kind: "start" });
    expect(registrationAction({ viva_account_id: null })).toEqual({ kind: "start" });
  });
  it("bestaand account met vertrouwde link = verder, nooit create", () => {
    expect(registrationAction({ viva_account_id: "acc", onboarding_url: "https://www.vivapayments.com/x" }))
      .toEqual({ kind: "continue", url: "https://www.vivapayments.com/x" });
  });
  it("bestaand account zonder of met onveilige link = missing_link, nooit create", () => {
    expect(registrationAction({ viva_account_id: "acc", onboarding_url: null }).kind).toBe("missing_link");
    expect(registrationAction({ viva_account_id: "acc", onboarding_url: "https://evil.com" }).kind).toBe("missing_link");
  });
  it("KYC labels in B1 Nederlands", () => {
    expect(kycLabel("kyc_pending")).toBe("Verificatie in behandeling");
    expect(kycLabel("verified")).toBe("Verificatie afgerond");
    expect(kycLabel(null)).toBe("Verificatie nog niet gestart");
    expect(onboardingLabel("invited")).toBe("Registratie gestart");
  });
});
