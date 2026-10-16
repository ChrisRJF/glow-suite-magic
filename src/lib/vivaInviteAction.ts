import { trustedVivaUrl } from "@/lib/vivaOnboardingUrl";

// Pure beslislogica voor de GlowPay-stap: wat doen we met het antwoord van
// create-viva-connected-account? Fail-closed: alleen een backend-bevestigde
// 'created'/'reused' met een HTTPS-allowlisted Viva-URL mag navigeren.
// 202/409/503/netwerkfouten geven uitsluitend een B1-uitleg, nooit een redirect
// en nooit een tweede poging.

export type InviteAction =
  | { kind: "navigate"; url: string }
  | { kind: "message"; text: string };

export const INVITE_UNAVAILABLE =
  "Registratie bij Viva is nog niet beschikbaar. Probeer het later of neem contact op met GlowSuite.";
export const INVITE_PENDING =
  "Je aanvraag is in behandeling. Maak geen nieuwe aanvraag aan; neem contact op met GlowSuite als dit lang duurt.";
export const INVITE_RECOVERY =
  "Je registratie moet handmatig worden hersteld. Neem contact op met GlowSuite; er wordt geen nieuw account aangemaakt.";
export const INVITE_NETWORK =
  "De aanvraag kon niet worden voltooid. Er is geen tweede registratie gestart. Neem bij twijfel contact op met GlowSuite.";

export function inviteActionFromResponse(res: {
  status?: string;
  onboarding_url?: string | null;
}): InviteAction {
  if ((res.status === "created" || res.status === "reused")) {
    const url = trustedVivaUrl(res.onboarding_url);
    if (url) return { kind: "navigate", url };
    // Status zonder vertrouwde URL: nooit navigeren, nooit succes beweren.
    return { kind: "message", text: INVITE_PENDING };
  }
  if (res.status === "busy" || res.status === "persistence_pending" || res.status === "reconciliation_required") {
    return { kind: "message", text: INVITE_PENDING };
  }
  return { kind: "message", text: INVITE_UNAVAILABLE };
}

export function inviteActionFromError(err: unknown): InviteAction {
  const msg = String((err as any)?.message || err || "").toLowerCase();
  if (msg.includes("manual_recovery")) return { kind: "message", text: INVITE_RECOVERY };
  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("timeout")) {
    return { kind: "message", text: INVITE_NETWORK };
  }
  return { kind: "message", text: INVITE_UNAVAILABLE };
}
