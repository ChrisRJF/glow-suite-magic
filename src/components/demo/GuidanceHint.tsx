import { useState } from "react";
import { Lightbulb, X } from "lucide-react";
import { useBeautycareDemo } from "@/hooks/useBeautycareDemo";

const KEY = (id: string) => `glowsuite_hint_${id}`;

interface Props {
  /** Stable id, used to hide the hint again within the same session. */
  id: string;
  text: string;
  className?: string;
}

/**
 * One quiet inline hint for the Beautycare demo. Never an overlay, never blocking.
 * Dismissal lives in sessionStorage only, so nothing is stored server side.
 */
export function GuidanceHint({ id, text, className = "" }: Props) {
  const { active } = useBeautycareDemo();
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(KEY(id)) === "1";
    } catch {
      return false;
    }
  });

  if (!active || hidden) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(KEY(id), "1");
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-border/60 bg-muted/35 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground ${className}`}
    >
      <Lightbulb className="h-3 w-3 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 break-words">{text}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Tip sluiten"
        className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
