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
    <section className="rounded-2xl border border-border/60 bg-card/70 p-4 sm:p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
      <h2 className="text-base font-semibold text-foreground">Welkom Danica 👋</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        We hebben deze demo alvast voor Beautycare Groningen ingericht. Bekijk hoe je afspraken, intakeformulieren,
        behandelverslagen, foto's en behandeltrajecten op één plek beheert. Probeer bijvoorbeeld eerst de afspraak van
        Sanne de Jong.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button variant="gradient" className="h-11 w-full sm:w-auto" onClick={() => navigate("/agenda")}>
          <CalendarDays className="h-4 w-4" /> Start met de agenda
        </Button>
        <Button variant="ghost" size="sm" className="h-11 w-full text-muted-foreground sm:w-auto" onClick={close}>
          Zelf rondkijken
        </Button>
      </div>
    </section>
  );
}
