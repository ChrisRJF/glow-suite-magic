// Allowlist for Viva onboarding/invitation URLs shown to salon owners.
// Only HTTPS URLs on official Viva hosts are ever opened; anything else
// (http, other domains, malformed values) is refused fail-closed.
const VIVA_HOSTS = new Set([
  "vivapayments.com",
  "www.vivapayments.com",
  "viva.com",
  "www.viva.com",
]);

export function isTrustedVivaUrl(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== "string") return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return VIVA_HOSTS.has(host) || host.endsWith(".vivapayments.com") || host.endsWith(".viva.com");
  } catch {
    return false;
  }
}

export function trustedVivaUrl(raw: string | null | undefined): string | null {
  return isTrustedVivaUrl(raw) ? (raw as string) : null;
}
