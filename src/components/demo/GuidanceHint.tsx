import { useEffect, useSyncExternalStore } from "react";
import { Lightbulb, X } from "lucide-react";
import { useBeautycareDemo } from "@/hooks/useBeautycareDemo";
import {
  GUIDANCE_TOTAL,
  activeStep,
  dismissStep,
  registerStep,
  subscribeGuidance,
} from "@/lib/demoGuidance";

interface Props {
  /** Step in the demo route, 1 through 4. */
  step: number;
  text: string;
  className?: string;
  /** One compact next action so the route is never a guessing game. */
  ctaLabel?: string;
  onCta?: () => void;
}

/**
 * One quiet inline hint for the Beautycare demo. Never an overlay, never blocking.
 * Only the lowest mounted, non-dismissed step is visible, so max one hint at a time.
 */
export function GuidanceHint({ step, text, className = "", ctaLabel, onCta }: Props) {
  const { active } = useBeautycareDemo();
  const current = useSyncExternalStore(subscribeGuidance, activeStep, () => null);

  useEffect(() => {
    if (!active) return;
    return registerStep(step);
  }, [active, step]);

  if (!active || current !== step) return null;

  return (
    <div
      className={`w-full max-w-full rounded-lg border border-border/60 bg-muted/35 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground ${className}`}
    >
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 break-words">
          <span className="mr-1 font-semibold text-foreground">
            {step} van {GUIDANCE_TOTAL}
          </span>
          {text}
        </p>
        <button
          type="button"
          onClick={() => dismissStep(step)}
          aria-label="Tip sluiten"
          className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {ctaLabel && onCta && (
        <button
          type="button"
          onClick={() => { dismissStep(step); onCta(); }}
          className="mt-2 flex h-9 w-full items-center justify-center rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
