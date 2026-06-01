import { DEFAULT_LANGUAGE, LANG_STORAGE_KEY, normalizeLanguage, type SupportedLanguage } from "./languages";

export function detectInitialLanguage(): SupportedLanguage {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("lang");
    if (fromUrl) return normalizeLanguage(fromUrl);
  } catch { /* noop */ }
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (stored) return normalizeLanguage(stored);
  } catch { /* noop */ }
  try {
    const nav = window.navigator.language || (window.navigator as any).userLanguage;
    if (nav) return normalizeLanguage(nav);
  } catch { /* noop */ }
  return DEFAULT_LANGUAGE;
}
