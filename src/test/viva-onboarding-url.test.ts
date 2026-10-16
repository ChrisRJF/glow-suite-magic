import { describe, it, expect } from "vitest";
import { isTrustedVivaUrl, trustedVivaUrl } from "@/lib/vivaOnboardingUrl";

describe("Viva onboarding URL allowlist", () => {
  it("accepts official Viva HTTPS hosts and subdomains", () => {
    expect(isTrustedVivaUrl("https://www.vivapayments.com/nl/signup/abc")).toBe(true);
    expect(isTrustedVivaUrl("https://accounts.vivapayments.com/invite/xyz")).toBe(true);
    expect(isTrustedVivaUrl("https://www.viva.com/onboarding")).toBe(true);
  });
  it("refuses http, other domains, lookalikes and malformed values", () => {
    expect(isTrustedVivaUrl("http://www.vivapayments.com/signup")).toBe(false);
    expect(isTrustedVivaUrl("https://evil-vivapayments.com/signup")).toBe(false);
    expect(isTrustedVivaUrl("https://vivapayments.com.evil.com/signup")).toBe(false);
    expect(isTrustedVivaUrl("https://example.com")).toBe(false);
    expect(isTrustedVivaUrl("javascript:alert(1)")).toBe(false);
    expect(isTrustedVivaUrl("not a url")).toBe(false);
    expect(isTrustedVivaUrl("")).toBe(false);
    expect(isTrustedVivaUrl(null)).toBe(false);
    expect(isTrustedVivaUrl(undefined)).toBe(false);
  });
  it("trustedVivaUrl returns the URL only when trusted", () => {
    const ok = "https://www.vivapayments.com/invite/1";
    expect(trustedVivaUrl(ok)).toBe(ok);
    expect(trustedVivaUrl("https://evil.com")).toBeNull();
  });
});
