import { describe, it, expect } from "vitest";
import { registrationView } from "@/lib/glowpayRegistrationStatus";

const activeRow = {
  viva_account_id: "acc-fake", viva_merchant_id: "m-fake", onboarding_status: "active",
  kyc_status: "verified", online_payments_enabled: true, viva_source_code: "SRC-FAKE",
  is_demo: false, onboarding_url: "https://www.vivapayments.com/invite/1",
};

describe("GlowPay registratie retourpagina view-state", () => {
  it("uitgelogd = signed_out, zonder status of link", () => {
    expect(registrationView({ signedIn: false, hadError: false, row: null, trustedUrl: null }))
      .toEqual({ kind: "signed_out" });
  });
  it("geen merchantrij = unavailable, nooit 'niet gestart' of een link", () => {
    const v = registrationView({ signedIn: true, hadError: false, row: null, trustedUrl: null });
    expect(v.kind).toBe("unavailable");
  });
  it("leesfout = unavailable, ook als er toevallig data lijkt te zijn", () => {
    expect(registrationView({ signedIn: true, hadError: true, row: activeRow, trustedUrl: null }).kind).toBe("unavailable");
  });
  it("echte rij geeft status; onbetrouwbare URL wordt nooit doorgegeven", () => {
    const ok = registrationView({ signedIn: true, hadError: false, row: activeRow, trustedUrl: activeRow.onboarding_url });
    expect(ok).toEqual({ kind: "status", status: "active", continueUrl: activeRow.onboarding_url });
    const bad = registrationView({ signedIn: true, hadError: false, row: { ...activeRow, onboarding_url: "https://evil.com" }, trustedUrl: null });
    expect(bad).toEqual({ kind: "status", status: "active", continueUrl: null });
  });
  it("pending zonder source code blijft pending, nooit actief", () => {
    const v = registrationView({ signedIn: true, hadError: false, row: { ...activeRow, viva_source_code: null }, trustedUrl: null });
    expect(v).toEqual({ kind: "status", status: "pending", continueUrl: null });
  });
});
