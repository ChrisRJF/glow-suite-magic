import { trustedVivaUrl } from "@/lib/vivaOnboardingUrl";

// Pure UX-helpers voor GlowPay/Viva-kaarten. Nooit approval simuleren:
// labels zijn alleen weergave; serverchecks (auth, pilot, KYC) blijven leidend.

export type MerchantLike = {
  viva_account_id?: string | null;
  onboarding_url?: string | null;
} | null | undefined;

export type RegistrationAction =
  | { kind: "start" }                    // nog geen account: create mag (server beslist)
  | { kind: "continue"; url: string }    // bestaand account: alleen opgeslagen link
  | { kind: "missing_link" };            // bestaand account zonder vertrouwde link: nooit create

export const MISSING_LINK_TEXT =
  "Je registratie bij Viva is al gestart, maar de link om verder te gaan is niet beschikbaar. Er wordt geen nieuw account aangemaakt. Neem contact op met GlowSuite.";

export function registrationAction(row: MerchantLike): RegistrationAction {
  if (!row?.viva_account_id) return { kind: "start" };
  const url = trustedVivaUrl(row.onboarding_url);
  return url ? { kind: "continue", url } : { kind: "missing_link" };
}

export function kycLabel(kyc: string | null | undefined): string {
  const k = String(kyc || "").toLowerCase();
  if (k === "verified" || k === "approved") return "Verificatie afgerond";
  if (k === "rejected") return "Verificatie afgewezen";
  if (k === "action_required" || k === "action_needed") return "Actie nodig bij Viva";
  if (!k) return "Verificatie nog niet gestart";
  return "Verificatie in behandeling";
}

export function onboardingLabel(status: string | null | undefined): string {
  const s = String(status || "").toLowerCase();
  if (s === "active") return "Account actief";
  if (s === "rejected" || s === "suspended") return "Account geblokkeerd";
  if (s === "action_required" || s === "action_needed") return "Actie nodig bij Viva";
  if (!s || s === "not_started") return "Nog niet gestart";
  return "Registratie gestart";
}
