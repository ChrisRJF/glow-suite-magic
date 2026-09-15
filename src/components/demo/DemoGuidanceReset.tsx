import { RotateCcw } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useBeautycareDemo } from "@/hooks/useBeautycareDemo";
import { resetDemoGuidance } from "@/lib/demoGuidance";
import { toast } from "@/hooks/use-toast";

/** Small reset link next to the demo badge. Resets only welcome block and hints. */
export function DemoGuidanceReset({ className = "" }: { className?: string }) {
  const { active } = useBeautycareDemo();
  const navigate = useNavigate();
  const location = useLocation();
  if (!active) return null;

  const handleReset = () => {
    resetDemoGuidance();
    toast({ title: "Demo-uitleg is opnieuw gestart", description: "Begin weer bij stap 1 van 4." });
    if (location.pathname !== "/dashboard") navigate("/dashboard");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <button
      type="button"
      onClick={handleReset}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/80 hover:text-foreground ${className}`}
    >
      <RotateCcw className="h-3 w-3" /> Uitleg opnieuw
    </button>
  );
}
