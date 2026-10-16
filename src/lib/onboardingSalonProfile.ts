// Builds the settings update payload for onboarding step 2.
// salon_type / salon_logo_url only become part of the write once the proposed migration
// docs/proposed-migrations/2026-10-16_settings_salon_type_logo.sql is applied AND this gate
// is switched to true. Until then only the verified column salon_name is sent.
export const SETTINGS_SALON_PROFILE_COLUMNS_ENABLED = false;

const SALON_TYPES = ["kapper", "barbershop", "nagelstudio", "beautysalon", "kliniek", "overig"];

/** Accepts only a public URL produced by the existing salon-logos upload under the user's own folder. */
export function isOwnSalonLogoUrl(url: string, userId: string, supabaseUrl: string): boolean {
  if (!url || !userId || !supabaseUrl) return false;
  const prefix = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/salon-logos/${userId}/`;
  if (!url.startsWith(prefix)) return false;
  const rest = url.slice(prefix.length);
  return /^logo-\d+\.[a-z0-9]{1,5}$/i.test(rest);
}

export function buildSettingsPayload(
  input: { name: string; salonType: string; logoUrl: string; userId: string; supabaseUrl: string },
  enabled: boolean = SETTINGS_SALON_PROFILE_COLUMNS_ENABLED,
): { payload: Record<string, string>; persistedExtras: boolean } {
  const payload: Record<string, string> = { salon_name: input.name };
  if (!enabled) return { payload, persistedExtras: false };
  let persistedExtras = false;
  if (input.salonType && SALON_TYPES.includes(input.salonType)) { payload.salon_type = input.salonType; persistedExtras = true; }
  if (isOwnSalonLogoUrl(input.logoUrl, input.userId, input.supabaseUrl)) { payload.salon_logo_url = input.logoUrl; persistedExtras = true; }
  return { payload, persistedExtras };
}
