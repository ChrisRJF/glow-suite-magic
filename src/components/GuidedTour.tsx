import { useEffect, useState, useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useAuth } from "@/contexts/AuthContext";

interface TourStep {
  selector: string;
  title: string;
  body: string;
  route?: string;
}

const STEPS: TourStep[] = [
  { selector: '[data-tour="daily-coach"]', title: "Stap 1 — Bekijk omzetkansen", body: "GlowSuite toont elke dag de meest waardevolle acties op basis van je data. Klik een kaart om direct actie te nemen." },
  { selector: '[data-tour="auto-revenue"]', title: "Stap 2 — Vul een lege plek automatisch", body: "De Auto Revenue Engine vult lege plekken in je agenda zonder dat jij iets hoeft te doen." },
  { selector: '[data-tour="customer-value"]', title: "Stap 3 — Bekijk klantwaarde", body: "Elke klant krijgt automatisch labels (VIP, Risico, Nieuw) en een aanbevolen volgende actie. Je ziet wat een klant waard is." },
  { selector: '[data-tour="owner-mode"]', title: "Stap 4 — Eigenaar overzicht", body: "Open de Eigenaar mode voor strategische metrics: marge per dienst, team performance en wekelijkse groei." },
];

export function GuidedTour() {
  const { demoMode, loading: demoLoading } = useDemoMode();
  const { user, loading: authLoading, bootstrapReady } = useAuth();
  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Auto-start in demo mode (once)
  useEffect(() => {
    if (!demoMode || !user || authLoading || demoLoading || !bootstrapReady) return;
    const key = `glowsuite_tour_${user.id}`;
    if (localStorage.getItem(key)) return;
    const t = setTimeout(() => {
      if (!document.querySelector('[role="dialog"]')) setActive(true);
    }, 1200);
    return () => clearTimeout(t);
  }, [demoMode, user, authLoading, demoLoading, bootstrapReady]);

  // Listen for global "start tour" event
  useEffect(() => {
    const onStart = () => {
      if (!user || authLoading || demoLoading || !bootstrapReady || document.querySelector('[role="dialog"]')) return;
      setStepIdx(0);
      setActive(true);
    };
    window.addEventListener("glowsuite:start-tour", onStart);
    return () => window.removeEventListener("glowsuite:start-tour", onStart);
  }, [user, authLoading, demoLoading, bootstrapReady]);

  const step = STEPS[stepIdx];

  useLayoutEffect(() => {
    if (!active || !step) return;
    const update = () => {
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => setRect(el.getBoundingClientRect()), 350);
      } else {
        setRect(null);
      }
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [active, step, stepIdx]);

  const finish = () => {
    setActive(false);
    if (user) localStorage.setItem(`glowsuite_tour_${user.id}`, "done");
  };

  const next = () => {
    if (stepIdx < STEPS.length - 1) setStepIdx(stepIdx + 1);
    else finish();
  };

  if (!active || !step) return null;

  // Tooltip placement
  const tooltipStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        top: Math.min(rect.bottom + 12, window.innerHeight - 200),
        left: Math.max(16, Math.min(rect.left, window.innerWidth - 360)),
        width: Math.min(340, window.innerWidth - 32),
        zIndex: 10000,
      }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: Math.min(340, window.innerWidth - 32), zIndex: 10000 };

  const highlightStyle: React.CSSProperties | undefined = rect
    ? {
        position: "fixed",
        top: rect.top - 6,
        left: rect.left - 6,
        width: rect.width + 12,
        height: rect.height + 12,
        borderRadius: 18,
        boxShadow: "0 0 0 9999px hsl(var(--background) / 0.78), 0 0 0 2px hsl(var(--primary)), 0 20px 60px hsl(var(--primary) / 0.4)",
        pointerEvents: "none",
        zIndex: 9999,
        transition: "all 0.3s ease",
      }
    : undefined;

  return (
    <>
      {!rect && (
        <div className="fixed inset-0 bg-background/78 z-[9999] pointer-events-auto" onClick={finish} />
      )}
      {highlightStyle && <div style={highlightStyle} />}
      <div style={tooltipStyle} className="rounded-2xl border border-primary/30 bg-card p-5 shadow-2xl animate-fade-in-up">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Stap {stepIdx + 1} van {STEPS.length}
            </p>
            <h3 className="text-sm font-semibold leading-tight">{step.title}</h3>
          </div>
          <button onClick={finish} className="p-1 rounded-lg hover:bg-secondary text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mb-4">{step.body}</p>
        <div className="flex items-center justify-between">
          <button onClick={finish} className="text-xs text-muted-foreground hover:text-foreground">
            Tour overslaan
          </button>
          <Button size="sm" variant="gradient" onClick={next}>
            {stepIdx === STEPS.length - 1 ? "Klaar" : "Volgende"} <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </>
  );
}
