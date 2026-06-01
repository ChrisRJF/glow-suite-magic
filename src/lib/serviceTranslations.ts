import type { SupportedLanguage } from "@/i18n/languages";

export interface ServiceTranslationEntry {
  name?: string | null;
  description?: string | null;
  category?: string | null;
}

export type ServiceTranslations = Partial<Record<SupportedLanguage, ServiceTranslationEntry>>;

export const TRANSLATABLE_LANGS: SupportedLanguage[] = ["en", "de", "fr", "es"];

function pick(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function localizedServiceName(
  service: { name: string; translations?: ServiceTranslations | null } | null | undefined,
  lang: string | undefined | null,
): string {
  if (!service) return "";
  const short = (lang || "nl").toLowerCase().split("-")[0] as SupportedLanguage;
  if (short !== "nl" && service.translations) {
    const t = pick(service.translations[short]?.name);
    if (t) return t;
  }
  return service.name;
}

export function localizedServiceDescription(
  service: { description?: string | null; translations?: ServiceTranslations | null } | null | undefined,
  lang: string | undefined | null,
): string | null {
  if (!service) return null;
  const short = (lang || "nl").toLowerCase().split("-")[0] as SupportedLanguage;
  if (short !== "nl" && service.translations) {
    const t = pick(service.translations[short]?.description);
    if (t) return t;
  }
  return pick(service.description);
}

export function localizedCategoryLabel(
  category: string,
  translationsList: Array<ServiceTranslations | null | undefined>,
  lang: string | undefined | null,
): string {
  if (!category) return category;
  const short = (lang || "nl").toLowerCase().split("-")[0] as SupportedLanguage;
  if (short === "nl") return category;
  for (const tr of translationsList) {
    const candidate = pick(tr?.[short]?.category);
    if (candidate) return candidate;
  }
  return category;
}
