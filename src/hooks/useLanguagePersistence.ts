import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { setLanguage } from "@/i18n";
import { normalizeLanguage } from "@/i18n/languages";

/**
 * Keeps i18n language in sync with the ?lang= URL parameter.
 * - On mount, if URL has ?lang=, switch to it (overrides stored preference).
 * - When language changes elsewhere, this hook does nothing — setLanguage() handles
 *   URL + localStorage persistence directly.
 *
 * Use on all customer-facing public pages (booking, portal, payment, etc.).
 */
export function useLanguagePersistence() {
  const { i18n } = useTranslation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      const fromUrl = url.searchParams.get("lang");
      if (fromUrl) {
        const lang = normalizeLanguage(fromUrl);
        if (lang !== i18n.language) setLanguage(lang);
      }
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
