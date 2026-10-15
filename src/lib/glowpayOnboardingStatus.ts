// Display-only mapping of existing merchant/settings data to wizard statuses.
// Mirrors wizardStatus in supabase/functions/_shared/inactive/isvOnboardingV2.ts.
// Never simulates approval: "active" requires an active row with merchant ID,
// verified KYC and live payments enabled; demo rows never count as active.
export type PayStatus = "not_started" | "pending" | "action_needed" | "active";
export type BookingStatus = "active" | "not_set_up";

export type MerchantStatusRow = {
  viva_account_id?: string | null;
  viva_merchant_id?: string | null;
  onboarding_status?: string | null;
  kyc_status?: string | null;
  online_payments_enabled?: boolean | null;
  is_demo?: boolean | null;
} | null;

export function glowpayPaymentStatus(row: MerchantStatusRow): PayStatus {
  if (!row?.viva_account_id) return "not_started";
  const s = String(row.onboarding_status || "").toLowerCase();
  const kyc = String(row.kyc_status || "").toLowerCase();
  if (["rejected", "suspended", "action_required", "action_needed"].includes(s) || ["rejected", "action_required"].includes(kyc)) return "action_needed";
  if (!row.is_demo && s === "active" && kyc === "verified" && !!row.viva_merchant_id && !!row.online_payments_enabled) return "active";
  return "pending";
}

export function bookingStatus(publicSlug: string | null | undefined): BookingStatus {
  return publicSlug && publicSlug.trim() ? "active" : "not_set_up";
}
