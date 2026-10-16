import { describe, it, expect } from "vitest";
import { inviteActionFromResponse, inviteActionFromError, INVITE_UNAVAILABLE, INVITE_PENDING, INVITE_RECOVERY, INVITE_NETWORK } from "@/lib/vivaInviteAction";
import { trustedVivaUrl } from "@/lib/vivaOnboardingUrl";

describe("Viva invite action (fail-closed)", () => {
  it("created/reused met vertrouwde HTTPS Viva-URL navigeert", () => {
    const url = "https://www.vivapayments.com/invite/abc";
    expect(inviteActionFromResponse({ status: "created", onboarding_url: url })).toEqual({ kind: "navigate", url });
    expect(inviteActionFromResponse({ status: "reused", onboarding_url: "https://accounts.vivawallet.com/x" }).kind).toBe("navigate");
  });
  it("created/reused zonder of met vervalste URL navigeert nooit", () => {
    expect(inviteActionFromResponse({ status: "created" }).kind).toBe("message");
    expect(inviteActionFromResponse({ status: "created", onboarding_url: "https://evil.com/x" }).kind).toBe("message");
    expect(inviteActionFromResponse({ status: "created", onboarding_url: "http://www.viva.com/x" }).kind).toBe("message");
    expect(inviteActionFromResponse({ status: "reused", onboarding_url: "javascript:alert(1)" }).kind).toBe("message");
  });
  it("202-statussen geven 'in behandeling', geen redirect en geen succes", () => {
    for (const s of ["busy", "persistence_pending", "reconciliation_required"]) {
      const a = inviteActionFromResponse({ status: s });
      expect(a).toEqual({ kind: "message", text: INVITE_PENDING });
    }
  });
  it("onbekende/ontbrekende status en disabled-server geven onbeschikbaar-uitleg", () => {
    expect(inviteActionFromResponse({})).toEqual({ kind: "message", text: INVITE_UNAVAILABLE });
    expect(inviteActionFromResponse({ status: "live_isv_disabled" })).toEqual({ kind: "message", text: INVITE_UNAVAILABLE });
  });
  it("fouten: manual recovery, netwerk en overig", () => {
    expect(inviteActionFromError(new Error("manual_recovery_required"))).toEqual({ kind: "message", text: INVITE_RECOVERY });
    expect(inviteActionFromError(new Error("Failed to fetch"))).toEqual({ kind: "message", text: INVITE_NETWORK });
    expect(inviteActionFromError(new Error("FunctionsHttpError: 503"))).toEqual({ kind: "message", text: INVITE_UNAVAILABLE });
  });
  it("URL-allowlist bevat vivawallet.com maar geen lookalikes", () => {
    expect(trustedVivaUrl("https://www.vivawallet.com/invite/1")).toBeTruthy();
    expect(trustedVivaUrl("https://vivawallet.com.evil.com/x")).toBeNull();
  });
});
