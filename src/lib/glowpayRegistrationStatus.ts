import { glowpayPaymentStatus, type MerchantStatusRow, type PayStatus } from "@/lib/glowpayOnboardingStatus";

// Pure view-state mapping for the Viva registration return page.
// Fail-closed: no merchant row (e.g. local persistence failed after a
// successful Viva signup) or a read error is NEVER shown as a definite
// conclusion; only a real row can produce a status, and only the strict
// mapper can produce "active".
export type RegistrationView =
  | { kind: "signed_out" }
  | { kind: "unavailable" }
  | { kind: "status"; status: PayStatus; continueUrl: string | null };

export function registrationView(opts: {
  signedIn: boolean;
  hadError: boolean;
  row: MerchantStatusRow & { onboarding_url?: string | null };
  trustedUrl: string | null;
}): RegistrationView {
  if (!opts.signedIn) return { kind: "signed_out" };
  if (opts.hadError || !opts.row) return { kind: "unavailable" };
  return { kind: "status", status: glowpayPaymentStatus(opts.row), continueUrl: opts.trustedUrl };
}
