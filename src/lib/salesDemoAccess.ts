import { useSettings } from "@/hooks/useSupabaseData";

/**
 * Sales demo showcase access.
 *
 * PRESENTATION ONLY. This never relaxes demo safety guards (real WhatsApp,
 * e-mail, payments, seed/reset). It only decides whether the safe, simulated
 * showcase flows (e.g. the Omzet Autopilot demo sequence) may be started on a
 * live tenant during a sales demo.
 *
 * Source of truth: settings.demo_mode (true demo tenant) OR the existing
 * settings.whitelabel_branding JSONB flag `sales_demo_access`.
 */
export function hasDemoShowcaseAccess(settingsRow: any): boolean {
  if (!settingsRow) return false;
  if (settingsRow.demo_mode) return true;
  const branding = settingsRow.whitelabel_branding;
  return Boolean(branding && typeof branding === "object" && branding.sales_demo_access === true);
}

export function useDemoShowcaseAccess() {
  const { data: settings, loading } = useSettings();
  const row = settings.length > 0 ? (settings[0] as any) : null;
  return { showcaseAccess: hasDemoShowcaseAccess(row), loading };
}
