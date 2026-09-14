import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBeautycareDemo } from "@/hooks/useBeautycareDemo";

const KEY = "glowsuite_welcome_beautycare";

/** Quiet welcome block, only inside the Beautycare demo. Presentation only. */
export function BeautycareWelcomeCard() {
  const { active } = useBeautycareDemo();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });

  if (!active || hidden) return null;

  const close = () => {
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card/70 p-3 sm:p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
      <h2 className="text-sm font-semibold text-foreground">Welkom Danicá</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
        Deze demo is alvast ingericht voor Beautycare Groningen. Bekijk hoe afspraken, intakeformulieren,
        behandelverslagen, foto’s en behandeltrajecten op één plek samenkomen.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button variant="gradient" size="sm" className="h-9 px-3" onClick={() => navigate("/agenda")}>
          <CalendarDays className="h-4 w-4" /> Start met de agenda
        </Button>
        <Button variant="link" size="sm" className="h-8 px-0 text-xs text-muted-foreground" onClick={close}>
          Zelf rondkijken
        </Button>
      </div>
    </section>
  );
}
