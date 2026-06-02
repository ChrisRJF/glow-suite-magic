import type { SalonLanguageConfig } from "./useEnforceSalonLanguage";

const KEY = "glowsuite_salon_lang_config";

/** Persist the salon's language config so other public pages can enforce it. */
export function cacheSalonLanguageConfig(config: SalonLanguageConfig | null | undefined) {
  if (typeof window === "undefined") return;
  try {
    if (!config) return;
    window.sessionStorage.setItem(KEY, JSON.stringify(config));
  } catch { /* noop */ }
}

/** Read the previously persisted salon language config, if any. */
export function readSalonLanguageConfig(): SalonLanguageConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SalonLanguageConfig) : null;
  } catch {
    return null;
  }
}
