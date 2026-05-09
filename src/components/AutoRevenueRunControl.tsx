/**
 * Shared run control: button + visual progress panel + result summary.
 *
 * Used by:
 *   - 🔥 Auto Revenue page hero
 *
 * Internally calls `useAutoRevenueRunner` which is the single source of truth.
 * Same hook is used by the Overview "Omzet Autopilot" engine card, so config
 * (maxDiscount/maxMessagesPerDay), demoMode, and scoredDecisions are
 * guaranteed identical at the same point in time.
 *
 * No new backend logic. No DB writes from this UI — only the runner writes.
 */
import { useCallback, useEffect, useState } from "react";
import { Rocket, Zap, Loader2, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useAutoRevenueRunner } from "@/hooks/useAutoRevenueRunner";
import { autopilotStateKey } from "@/lib/demoIsolation";
import { formatEuro } from "@/lib/data";
import { toast } from "sonner";

const RUN_STEPS = [
  "Agenda analyseren…",
  "Lege plekken zoeken…",
  "Beste klanten selecteren…",
  "WhatsApp acties voorbereiden…",
  "Resultaten opslaan…",
];

interface RunSummary {
  actions: number;
  revenue: number;
  customersReached: number;
  noAction: boolean;
}

interface AutoRevenueRunControlProps {
  /** Optional: hide the surrounding Card wrapper (e.g. when caller already provides a card). */
  bare?: boolean;
  /** Optional callback fired after a successful run so caller can refresh KPIs. */
  onRunComplete?: () => void;
  /** Optional secondary slot rendered next to the primary button. */
  secondary?: React.ReactNode;
}

export function AutoRevenueRunControl({ bare, onRunComplete, secondary }: AutoRevenueRunControlProps) {
  const { demoMode } = useDemoMode();
  const { running, runAutopilot, ready, scoredDecisions, projectedExtraRevenue, rankedCustomers } =
    useAutoRevenueRunner({ source: "auto-revenue-page" });

  const [autopilotEnabled, setAutopilotEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(autopilotStateKey(demoMode));
      return raw ? Boolean(JSON.parse(raw)?.enabled) : false;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(autopilotStateKey(demoMode));
      setAutopilotEnabled(raw ? Boolean(JSON.parse(raw)?.enabled) : false);
    } catch {
      setAutopilotEnabled(false);
    }
  }, [demoMode]);

  const [currentStep, setCurrentStep] = useState<number>(-1);
  const [lastSummary, setLastSummary] = useState<RunSummary | null>(null);

  useEffect(() => {
    if (!running) return;
    setCurrentStep(0);
    setLastSummary(null);
    const id = setInterval(() => {
      setCurrentStep((s) => Math.min(RUN_STEPS.length - 1, s + 1));
    }, 700);
    return () => clearInterval(id);
  }, [running]);

  const handleClick = useCallback(async () => {
    if (running || !ready) return;
    // Activate autopilot in localStorage if needed (same key as Overview engine).
    if (!autopilotEnabled) {
      try {
        const key = autopilotStateKey(demoMode);
        const raw = localStorage.getItem(key);
        const current = raw ? JSON.parse(raw) : { enabled: false, maxDiscount: 15, maxMessagesPerDay: 10 };
        localStorage.setItem(key, JSON.stringify({ ...current, enabled: true }));
        setAutopilotEnabled(true);
        toast.success("Auto Revenue staat nu actief ✅");
      } catch {}
    }
    const actions = scoredDecisions.length;
    const revenue = projectedExtraRevenue;
    const cap = scoredDecisions.length || 1;
    const customersReached = Math.min(rankedCustomers.length, cap);
    try {
      await runAutopilot();
      setCurrentStep(RUN_STEPS.length);
      setLastSummary({
        actions,
        revenue,
        customersReached,
        noAction: actions === 0,
      });
    } catch (e) {
      console.warn("auto revenue run failed", e);
      setCurrentStep(-1);
    } finally {
      onRunComplete?.();
    }
  }, [running, ready, autopilotEnabled, demoMode, scoredDecisions, projectedExtraRevenue, rankedCustomers, runAutopilot, onRunComplete]);

  const button = (
    <div className="flex flex-col sm:flex-row gap-2">
      <Button size="lg" onClick={handleClick} disabled={running || !ready} className="shadow-md">
        {running ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Bezig…</>
        ) : !ready ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Gegevens laden…</>
        ) : autopilotEnabled ? (
          <><Zap className="w-4 h-4 mr-2" /> Nu uitvoeren</>
        ) : (
          <><Rocket className="w-4 h-4 mr-2" /> Start Auto Revenue</>
        )}
      </Button>
      {secondary}
    </div>
  );

  const panel = (running || lastSummary) && (
    <div className="mt-4">
      {running ? (
        <>
          <div className="flex items-center gap-2 mb-3">
            <Loader2 className="w-4 h-4 text-primary animate-spin" />
            <p className="text-sm font-medium">Auto Revenue draait…</p>
          </div>
          <ul className="space-y-2">
            {RUN_STEPS.map((label, i) => {
              const done = i < currentStep;
              const active = i === currentStep;
              return (
                <li
                  key={label}
                  className={`flex items-center gap-2 text-sm transition-colors ${
                    done
                      ? "text-emerald-700 dark:text-emerald-400"
                      : active
                        ? "text-foreground font-medium"
                        : "text-muted-foreground/60"
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  ) : active ? (
                    <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                  ) : (
                    <Circle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  )}
                  <span>{label}</span>
                </li>
              );
            })}
          </ul>
        </>
      ) : lastSummary ? (
        lastSummary.noAction ? (
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
            <p className="text-sm">Geen actie nodig — agenda ziet er goed uit 👍</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <p className="text-sm font-medium">Auto Revenue uitgevoerd ✅</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-border bg-secondary/40 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Acties</p>
                <p className="text-base font-semibold tabular-nums mt-0.5">{lastSummary.actions}</p>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-emerald-700/80 dark:text-emerald-400/80">Omzet</p>
                <p className="text-base font-semibold tabular-nums mt-0.5 text-emerald-700 dark:text-emerald-400">{formatEuro(lastSummary.revenue)}</p>
              </div>
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-primary/80">Klanten</p>
                <p className="text-base font-semibold tabular-nums mt-0.5 text-primary">{lastSummary.customersReached}</p>
              </div>
            </div>
          </>
        )
      ) : null}
    </div>
  );

  if (bare) {
    return (
      <div>
        {button}
        {panel}
      </div>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardContent className="p-4 sm:p-5">
        {button}
        {panel}
      </CardContent>
    </Card>
  );
}
