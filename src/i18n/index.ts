import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { detectInitialLanguage } from "./detect";
import {
  DEFAULT_LANGUAGE,
  LANG_STORAGE_KEY,
  SUPPORTED_LANGUAGE_CODES,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "./languages";
import nl from "./locales/nl.json";
import en from "./locales/en.json";
import de from "./locales/de.json";
import fr from "./locales/fr.json";
import es from "./locales/es.json";

export const resources = {
  nl: { translation: nl },
  en: { translation: en },
  de: { translation: de },
  fr: { translation: fr },
  es: { translation: es },
} as const;

const initial = detectInitialLanguage();

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: initial,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGE_CODES as unknown as string[],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

applyHtmlLangAttr(initial);

export function setLanguage(lang: SupportedLanguage, opts: { persist?: boolean; updateUrl?: boolean } = {}) {
  const { persist = true, updateUrl = true } = opts;
  if (i18n.language !== lang) void i18n.changeLanguage(lang);
  if (persist && typeof window !== "undefined") {
    try { window.localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* noop */ }
  }
  if (updateUrl && typeof window !== "undefined") {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("lang") !== lang) {
        url.searchParams.set("lang", lang);
        window.history.replaceState({}, "", url.toString());
      }
    } catch { /* noop */ }
  }
  applyHtmlLangAttr(lang);
}

function applyHtmlLangAttr(lang: SupportedLanguage) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  const dir = SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.dir ?? "ltr";
  document.documentElement.dir = dir;
}

export default i18n;
