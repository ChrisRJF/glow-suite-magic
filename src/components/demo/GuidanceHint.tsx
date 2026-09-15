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
}

/**
 * One quiet inline hint for the Beautycare demo. Never an overlay, never blocking.
 * Only the lowest mounted, non-dismissed step is visible, so max one hint at a time.
 */
export function GuidanceHint({ step, text, className = "" }: Props) {
  const { active } = useBeautycareDemo();
  const current = useSyncExternalStore(subscribeGuidance, activeStep, () => null);

  useEffect(() => {
    if (!active) return;
    return registerStep(step);
  }, [active, step]);

  if (!active || current !== step) return null;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-border/60 bg-muted/35 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground ${className}`}
    >
      <Lightbulb className="h-3 w-3 shrink-0 text-primary" />
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
  );
}
