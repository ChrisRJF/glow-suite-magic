// Privacy-sanitized error reporting for the onboarding salon save (step 2).
// Never echoes raw provider messages, tokens, record IDs or personal data:
// only a fixed phase label plus a fixed reason chosen from the error code.

export type OnboardingSavePhase = "profile" | "settings_lookup" | "settings_update" | "services_check" | "services_seed";

const PHASE_LABEL: Record<OnboardingSavePhase, string> = {
  profile: "Salonnaam opslaan",
  settings_lookup: "Salongegevens ophalen",
  settings_update: "Salongegevens bijwerken",
  services_check: "Behandelingen controleren",
  services_seed: "Standaardbehandelingen toevoegen",
};

export class OnboardingSaveError extends Error {
  phase: OnboardingSavePhase;
  code: string | null;
  constructor(phase: OnboardingSavePhase, cause: unknown) {
    const code = extractCode(cause);
    super(`onboarding_save_failed:${phase}:${code ?? "unknown"}`);
    this.name = "OnboardingSaveError";
    this.phase = phase;
    this.code = code;
  }
}

function extractCode(cause: unknown): string | null {
  const c = (cause as any)?.code;
  // Only accept short alphanumeric codes (e.g. PGRST116, 42501); anything else is dropped.
  return typeof c === "string" && /^[A-Z0-9]{3,10}$/i.test(c) ? c.toUpperCase() : null;
}

function reasonFor(code: string | null): string {
  switch (code) {
    case "PGRST116":
      return "er zijn meerdere salonprofielen voor dit account gevonden. Neem contact op met support; er is niets overschreven.";
    case "42501":
    case "PGRST301":
      return "dit account heeft geen rechten voor deze stap. Neem contact op met de eigenaar of support.";
    case "PGRST204":
      return "een veld voor logo of salontype bestaat nog niet in de database. Je salonnaam is niet overschreven; neem contact op met support.";
    case "23505":
      return "deze gegevens bestaan al. Je eerdere keuzes zijn bewaard.";
    case "23514":
    case "22P02":
      return "een ingevulde waarde wordt niet geaccepteerd. Controleer je invoer.";
    default:
      return "probeer het opnieuw. Blijft dit gebeuren, neem dan contact op met support.";
  }
}

export function describeOnboardingSaveError(err: unknown): string {
  if (err instanceof OnboardingSaveError) {
    const ref = err.code ? ` (code ${err.code})` : "";
    return `${PHASE_LABEL[err.phase]} is niet gelukt${ref}: ${reasonFor(err.code)}`;
  }
  return "Er ging iets mis bij het opslaan. Probeer het opnieuw.";
}
