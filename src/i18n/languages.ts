export type SupportedLanguage = "nl" | "en" | "de" | "fr" | "es";

export interface LanguageDescriptor {
  code: SupportedLanguage;
  label: string;
  nativeLabel: string;
  flag: string;
  dir: "ltr" | "rtl";
}

export const SUPPORTED_LANGUAGES: LanguageDescriptor[] = [
  { code: "nl", label: "Dutch", nativeLabel: "Nederlands", flag: "🇳🇱", dir: "ltr" },
  { code: "en", label: "English", nativeLabel: "English", flag: "🇬🇧", dir: "ltr" },
  { code: "de", label: "German", nativeLabel: "Deutsch", flag: "🇩🇪", dir: "ltr" },
  { code: "fr", label: "French", nativeLabel: "Français", flag: "🇫🇷", dir: "ltr" },
  { code: "es", label: "Spanish", nativeLabel: "Español", flag: "🇪🇸", dir: "ltr" },
];

export const DEFAULT_LANGUAGE: SupportedLanguage = "nl";
export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);
export const LANG_STORAGE_KEY = "glowsuite_lang";

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === "string" && (SUPPORTED_LANGUAGE_CODES as string[]).includes(value);
}

export function normalizeLanguage(value: string | null | undefined): SupportedLanguage {
  if (!value) return DEFAULT_LANGUAGE;
  const short = value.toLowerCase().split("-")[0];
  return isSupportedLanguage(short) ? short : DEFAULT_LANGUAGE;
}
