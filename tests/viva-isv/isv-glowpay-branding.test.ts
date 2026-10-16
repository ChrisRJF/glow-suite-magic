import { describe, expect, it } from "vitest";
import { GLOWPAY_ACCENT_COLOR, glowPayVivaBranding } from "../../supabase/functions/_shared/inactive/isvGlowPayBranding";
import { buildCreatePayload } from "../../supabase/functions/_shared/inactive/isvOnboardingV2";

describe("confirmed GlowPay branding", () => {
  it("uses confirmed dark blue for Viva primaryColor", () => {
    const payload = buildCreatePayload({ email: "owner@test.example", returnUrl: "https://glowsuite.nl/glowpay", branding: glowPayVivaBranding() });
    expect(payload?.branding.primaryColor).toBe("#002448");
  });
  it("keeps confirmed green as a separate accent", () => {
    expect(GLOWPAY_ACCENT_COLOR).toBe("#00C878");
  });
  it("preserves the verified official public logo URL", () => {
    expect(glowPayVivaBranding().logoUrl).toBe("https://glowsuite.nl/__l5e/assets-v1/b5dafa8b-3daf-4b09-927d-474084acabdc/glowpay-logo.png");
  });
});