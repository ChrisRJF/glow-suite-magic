// Beautycare-only trial extension notice. Date always comes from the stored trial_ends_at.
export const TRIAL_EXTENSION_TENANTS: ReadonlySet<string> = new Set(["1c6c885e-c944-4717-b2ef-9cfdb9fa15ae"]);

/** Returns the banner text or null (then the normal banner logic applies). */
export function trialExtensionText(
  tenantId: unknown,
  sub: { status?: string | null; trial_ends_at?: string | null } | null | undefined,
  now: number = Date.now(),
): string | null {
  if (typeof tenantId !== "string" || !TRIAL_EXTENSION_TENANTS.has(tenantId)) return null;
  if (!sub || sub.status !== "trialing" || !sub.trial_ends_at) return null;
  const end = new Date(sub.trial_ends_at);
  if (isNaN(end.getTime()) || end.getTime() <= now) return null;
  const label = end.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
  return `Je gratis proefperiode is verlengd tot ${label}.`;
}
