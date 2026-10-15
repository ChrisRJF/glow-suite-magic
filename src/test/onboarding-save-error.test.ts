import { describe, it, expect } from "vitest";
import { OnboardingSaveError, describeOnboardingSaveError } from "@/lib/onboardingSaveError";

describe("onboarding save error", () => {
  it("multiple settings rows names the phase and code, no raw details", () => {
    const msg = describeOnboardingSaveError(new OnboardingSaveError("settings_lookup", { code: "PGRST116", message: "user 1234-abcd jan@example.com", details: "token xyz" }));
    expect(msg).toContain("Salongegevens ophalen");
    expect(msg).toContain("PGRST116");
    expect(msg).not.toMatch(/1234|jan@|token|xyz/);
  });
  it("permission errors are actionable", () => {
    expect(describeOnboardingSaveError(new OnboardingSaveError("profile", { code: "42501" }))).toContain("geen rechten");
  });
  it("drops non-code strings", () => {
    const e = new OnboardingSaveError("services_seed", { code: "eyJhbGciOi.secret-token" });
    expect(e.code).toBeNull();
    expect(describeOnboardingSaveError(e)).not.toContain("eyJ");
  });
  it("unknown errors stay generic", () => {
    expect(describeOnboardingSaveError(new Error("raw jan@example.com"))).not.toContain("jan@");
  });
});
