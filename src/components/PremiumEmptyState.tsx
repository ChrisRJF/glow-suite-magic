import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface Props {
  icon?: LucideIcon;
  title: string;
  description?: string;
  cta?: { label: string; onClick: () => void; variant?: "default" | "gradient" | "outline" };
  secondary?: { label: string; onClick: () => void };
  className?: string;
}

/** Calm, premium empty state used across GlowSuite. */
export function PremiumEmptyState({ icon: Icon, title, description, cta, secondary, className }: Props) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-14 px-6 rounded-2xl border border-dashed border-border/60 bg-gradient-to-b from-secondary/20 to-background animate-fade-in", className)}>
      {Icon && (
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/15 to-primary-glow/15 flex items-center justify-center ring-1 ring-primary/15 mb-4">
          <Icon className="w-5 h-5 text-primary" strokeWidth={1.75} />
        </div>
      )}
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1.5 max-w-sm leading-relaxed">{description}</p>}
      {(cta || secondary) && (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
          {cta && (
            <Button variant={cta.variant || "gradient"} size="sm" onClick={cta.onClick} className="rounded-lg shadow-sm">
              {cta.label}
            </Button>
          )}
          {secondary && (
            <Button variant="ghost" size="sm" onClick={secondary.onClick} className="rounded-lg text-muted-foreground hover:text-foreground">
              {secondary.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
