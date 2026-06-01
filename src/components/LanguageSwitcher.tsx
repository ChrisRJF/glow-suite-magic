import { useTranslation } from "react-i18next";
import { Globe, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { SUPPORTED_LANGUAGES, normalizeLanguage, type SupportedLanguage } from "@/i18n/languages";
import { setLanguage } from "@/i18n";
import { cn } from "@/lib/utils";

interface LanguageSwitcherProps {
  variant?: "compact" | "full";
  className?: string;
  onChange?: (lang: SupportedLanguage) => void;
}

export function LanguageSwitcher({ variant = "compact", className, onChange }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const current = normalizeLanguage(i18n.language);
  const currentLang = SUPPORTED_LANGUAGES.find((l) => l.code === current) ?? SUPPORTED_LANGUAGES[0];

  const handleSelect = (lang: SupportedLanguage) => {
    setLanguage(lang);
    onChange?.(lang);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("common.selectLanguage")}
          className={cn(
            "gap-2 h-9 px-2.5 text-foreground/80 hover:text-foreground",
            className,
          )}
        >
          <span className="text-base leading-none" aria-hidden="true">{currentLang.flag}</span>
          {variant === "full" ? (
            <span className="text-sm font-medium">{currentLang.nativeLabel}</span>
          ) : (
            <span className="text-xs font-semibold uppercase tracking-wide hidden sm:inline">{currentLang.code}</span>
          )}
          <Globe className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onSelect={() => handleSelect(lang.code)}
            className="gap-2 cursor-pointer"
          >
            <span className="text-base leading-none" aria-hidden="true">{lang.flag}</span>
            <span className="flex-1 text-sm">{lang.nativeLabel}</span>
            {current === lang.code && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default LanguageSwitcher;
