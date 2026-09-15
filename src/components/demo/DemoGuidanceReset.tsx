import { RotateCcw } from "lucide-react";
import { useBeautycareDemo } from "@/hooks/useBeautycareDemo";
import { resetDemoGuidance } from "@/lib/demoGuidance";

/** Small reset link next to the demo badge. Resets only welcome block and hints. */
export function DemoGuidanceReset({ className = "" }: { className?: string }) {
  const { active } = useBeautycareDemo();
  if (!active) return null;

  return (
    <button
      type="button"
      onClick={resetDemoGuidance}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground sm:text-[11px] ${className}`}
    >
      <RotateCcw className="h-3 w-3" /> Demo-uitleg opnieuw tonen
    </button>
  );
}
