import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface WhyHintProps {
  children: React.ReactNode;
  className?: string;
  icon?: boolean;
}

/**
 * Tiny muted explanation text — used to surface *why* GlowSuite acted
 * (e.g. "Verstuurd omdat klant 7 weken inactief was").
 * Keep copy short, factual, and based on real data only.
 */
export function WhyHint({ children, className, icon = true }: WhyHintProps) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground/80",
        className,
      )}
    >
      {icon && <Info className="w-3 h-3 mt-[2px] flex-shrink-0 opacity-70" />}
      <span>{children}</span>
    </p>
  );
}
