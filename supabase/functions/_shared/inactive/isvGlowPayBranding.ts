// PREPARED ONLY. No active entrypoint imports this module.
import { GLOWPAY_LOGO_URL, type Branding } from "./isvOnboardingV2.ts";

export const GLOWPAY_PRIMARY_COLOR = "#002448";
export const GLOWPAY_ACCENT_COLOR = "#00C878";

/** Owner-confirmed GlowPay branding, not GlowSuite theme tokens. */
export function glowPayVivaBranding(): Branding {
  return { partnerName: "GlowPay", logoUrl: GLOWPAY_LOGO_URL, primaryColor: GLOWPAY_PRIMARY_COLOR };
}