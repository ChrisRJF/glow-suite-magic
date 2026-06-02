import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { isSupportedLanguage, normalizeLanguage, SUPPORTED_LANGUAGE_CODES, type SupportedLanguage } from "./languages";

export interface SalonLanguageConfig {
  /** Salon default language (settings.language). */
  default_language?: string | null;
  /** Whitelist of languages enabled by salon owner. */
  active_languages?: string[] | null;
  /** Allow customers to switch language? */
  allow_customer_language_switch?: boolean | null;
  /** Use browser language for first-time visitors? */
  auto_detect_language?: boolean | null;
}

export interface EnforcedLanguageSettings {
  allowedLanguages: SupportedLanguage[];
  showSwitcher: boolean;
  defaultLanguage: SupportedLanguage;
}

/**
 * Enforce a salon's language configuration on the active i18n instance.
 *
 * - Filters the `active_languages` whitelist (defaults to all supported).
 * - Forces the salon default when `auto_detect_language=false` and the user
 *   hasn't explicitly picked a language via `?lang=` / localStorage.
 * - Snaps the current language back to the default if the active selection is
 *   no longer in the whitelist.
 *
 * Returns the resolved configuration so callers can pass it to
 * <LanguageSwitcher allowedLanguages hidden />.
 */
export function useEnforceSalonLanguage(
  config: SalonLanguageConfig | null | undefined,
): EnforcedLanguageSettings {
  const { i18n } = useTranslation();

  const resolved = useMemo<EnforcedLanguageSettings>(() => {
    const defaultLanguage = normalizeLanguage(config?.default_language || "nl");
    const rawAllowed = (config?.active_languages || []).filter(isSupportedLanguage) as SupportedLanguage[];
    let allowedLanguages: SupportedLanguage[] = rawAllowed.length > 0
      ? rawAllowed
      : ([...SUPPORTED_LANGUAGE_CODES] as SupportedLanguage[]);
    // Ensure salon default is always in the allowed set.
    if (!allowedLanguages.includes(defaultLanguage)) allowedLanguages = [defaultLanguage, ...allowedLanguages];
    const showSwitcher = config?.allow_customer_language_switch !== false;
    return { allowedLanguages, showSwitcher, defaultLanguage };
  }, [config?.default_language, JSON.stringify(config?.active_languages || []), config?.allow_customer_language_switch]);

  useEffect(() => {
    if (!config) return;
    const current = normalizeLanguage(i18n.language);
    let next: SupportedLanguage | null = null;

    // Detect whether user has an explicit choice in URL or localStorage.
    let hasExplicitChoice = false;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("lang")) hasExplicitChoice = true;
    } catch { /* noop */ }
    try {
      if (!hasExplicitChoice && window.localStorage.getItem("glowsuite_lang")) {
        hasExplicitChoice = true;
      }
    } catch { /* noop */ }

    // 1. auto_detect_language=false → force default unless user picked one.
    if (config.auto_detect_language === false && !hasExplicitChoice && current !== resolved.defaultLanguage) {
      next = resolved.defaultLanguage;
    }
    // 2. Switcher disabled → always force default.
    if (config.allow_customer_language_switch === false && current !== resolved.defaultLanguage) {
      next = resolved.defaultLanguage;
    }
    // 3. Current language not in whitelist → fall back to default.
    if (!resolved.allowedLanguages.includes(current)) {
      next = resolved.defaultLanguage;
    }

    if (next && next !== current) {
      void i18n.changeLanguage(next);
    }
  }, [config, resolved, i18n]);

  return resolved;
}
