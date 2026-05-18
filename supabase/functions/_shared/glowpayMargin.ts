// Centralized GlowPay platform margin.
// Single source of truth — do NOT hardcode the value elsewhere.
// Update this constant to change the margin everywhere it is applied.
export const GLOWPAY_MARGIN_CENTS = 30; // €0.30
export const GLOWPAY_MARGIN_EUROS = GLOWPAY_MARGIN_CENTS / 100;
