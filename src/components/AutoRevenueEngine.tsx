import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import {
  Zap, MessageCircle, CalendarPlus, TrendingUp, Clock,
  Settings2, ChevronDown, ChevronUp, Activity, CheckCircle2,
  Play, RotateCcw, Loader2
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAppointments } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useAutoRevenueRunner } from "@/hooks/useAutoRevenueRunner";
import { actionLogKey, autopilotLastRunKey, autopilotStateKey, clearLegacyDemoLocalState, demoStateKey } from "@/lib/demoIsolation";
import { formatEuro } from "@/lib/data";
import { actionLabel } from "@/lib/demoMode";
import { ACTION_LABELS } from "@/lib/autopilotScoring";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AutoRevenueMetrics } from "@/components/AutoRevenueMetrics";

interface ActionLogEntry {
  id: string;
  timestamp: Date;
  type: "campaign" | "discount" | "rebook" | "demo";
  description: string;
  result: string;
  revenue: number;
}

interface DemoState {
  hasRun: boolean;
  addedAppointments: number;
  addedRevenue: number;
  addedAppointmentIds: string[];
}

function getAutopilotState(demoMode: boolean) {
  try {
    const raw = localStorage.getItem(autopilotStateKey(demoMode));
    if (raw) return JSON.parse(raw);
  } catch {}
  return { enabled: false, maxDiscount: 15, maxMessagesPerDay: 10 };
}

function saveAutopilotState(state: any, demoMode: boolean) {
  localStorage.setItem(autopilotStateKey(demoMode), JSON.stringify(state));
}

function getDemoState(): DemoState {
  try {
    const raw = localStorage.getItem(demoStateKey());
    if (raw) return JSON.parse(raw);
  } catch {}
  return { hasRun: false, addedAppointments: 0, addedRevenue: 0, addedAppointmentIds: [] };
}

function saveDemoState(state: DemoState) {
  localStorage.setItem(demoStateKey(), JSON.stringify(state));
  // Also persist to action log for KPI
  try {
    const key = actionLogKey(true);
    const log = JSON.parse(localStorage.getItem(key) || "[]");
    // Remove old demo entries
    const filtered = log.filter((e: any) => e.type !== "demo");
    if (state.addedRevenue > 0) {
      filtered.push({ type: "demo", revenue: state.addedRevenue, timestamp: new Date().toISOString() });
    }
    localStorage.setItem(key, JSON.stringify(filtered));
  } catch {}
}

const DEMO_BOOKINGS = [
  { name: "Lisa Jansen", service: "Knippen + Föhnen", price: 45 },
  { name: "Noor van Dijk", service: "Kleuren + Knippen", price: 85 },
  { name: "Emma de Vries", service: "Highlights", price: 120 },
];

type DemoStep = {
  label: string;
  duration: number; // ms
};

const DEMO_STEPS: DemoStep[] = [
  { label: "AI analyseert agenda...", duration: 1500 },
  { label: "Lege plekken gedetecteerd", duration: 1000 },
  { label: "Klanten geselecteerd", duration: 1200 },
  { label: "Berichten verzonden via WhatsApp", duration: 1500 },
  { label: "Afspraken worden ingepland...", duration: 1800 },
];

export function AutoRevenueEngine() {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const { data: appointments, refetch: refetchAppointments } = useAppointments();
  // removeAppointment kept only for defensive cleanup of legacy demo rows.
  const { remove: removeAppointment } = useCrud("appointments");

  const [autopilot, setAutopilot] = useState(() => getAutopilotState(demoMode));
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);
  const [offerLogs, setOfferLogs] = useState<Array<{ id: string; status: string; created_at: string }>>([]);
  const [showLog, setShowLog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const addLog = useCallback((entry: Omit<ActionLogEntry, "id" | "timestamp">) => {
    setActionLog(prev => [{
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    }, ...prev].slice(0, 50));
  }, []);

  const {
    running,
    runAutopilot,
    ready,
    notReadyReason,
    scoredDecisions,
    projectedExtraRevenue,
    emptySlots,
    avgServicePrice,
    todaysAppts,
    inactiveCustomers,
  } = useAutoRevenueRunner({
    maxDiscount: autopilot.maxDiscount,
    maxMessagesPerDay: autopilot.maxMessagesPerDay,
    source: "overview",
    onLog: addLog,
  });


  // Demo flow state
  const [demoState, setDemoState] = useState<DemoState>(getDemoState);
  const [demoRunning, setDemoRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [demoProgress, setDemoProgress] = useState(0);
  const [demoComplete, setDemoComplete] = useState(false);

  useEffect(() => {
    clearLegacyDemoLocalState();
    setAutopilot(getAutopilotState(demoMode));
  }, [demoMode]);

  // Load recent Auto Revenue offer logs (read-only display)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("auto_revenue_offers")
        .select("id, status, created_at")
        .eq("user_id", user.id)
        .eq("is_demo", demoMode)
        .order("created_at", { ascending: false })
        .limit(10);
      if (!cancelled) setOfferLogs((data as any) || []);
    })();
    return () => { cancelled = true; };
  }, [user, demoMode, actionLog.length]);

  const todayStr = new Date().toISOString().split("T")[0];
  const totalSlots = 10;

  const totalRevenue = actionLog.reduce((s, e) => s + e.revenue, 0) + demoState.addedRevenue;
  const totalActions = actionLog.length + demoState.addedAppointments;

  const toggleAutopilot = (enabled: boolean) => {
    const next = { ...autopilot, enabled };
    setAutopilot(next);
    saveAutopilotState(next, demoMode);
    toast.success(enabled ? "Autopilot ingeschakeld ✨" : "Autopilot uitgeschakeld");
  };

  const updateSetting = (key: string, value: number) => {
    const next = { ...autopilot, [key]: value };
    setAutopilot(next);
    saveAutopilotState(next, demoMode);
  };

  // === DEMO FLOW (pure simulation — no DB writes) ===
  const runDemoSequence = useCallback(async () => {
    if (!user || demoRunning) return;
    if (!demoMode) {
      toast.error("Deze actie is alleen beschikbaar in demo modus.");
      return;
    }
    setDemoRunning(true);
    setDemoComplete(false);
    setCurrentStep(-1);
    setDemoProgress(0);
    setShowLog(true);

    // Animated phases — log entries are local UI state only.
    for (let i = 0; i < DEMO_STEPS.length; i++) {
      setCurrentStep(i);
      setDemoProgress(Math.round(((i + 1) / (DEMO_STEPS.length + 1)) * 100));
      addLog({
        type: "demo",
        description: DEMO_STEPS[i].label,
        result: "✓",
        revenue: 0,
      });
      await new Promise(r => setTimeout(r, DEMO_STEPS[i].duration));
    }

    // Simulate filled slots — NO inserts into appointments/campaigns/whatsapp_logs.
    const bookingsToAdd = DEMO_BOOKINGS.slice(0, Math.min(2, emptySlots || 2));
    let addedRev = 0;

    for (const booking of bookingsToAdd) {
      const rev = Number(booking.price);
      addedRev += rev;
      addLog({
        type: "demo",
        description: `${booking.name} → ${booking.service} (gesimuleerd)`,
        result: `+${formatEuro(rev)}`,
        revenue: rev,
      });
      // Tiny delay so the log animates nicely.
      await new Promise(r => setTimeout(r, 200));
    }

    // Simulate the WhatsApp blast — log only.
    addLog({
      type: "demo",
      description: `WhatsApp simulatie — ${bookingsToAdd.length} berichten "verstuurd"`,
      result: "Gesimuleerd",
      revenue: 0,
    });

    setDemoProgress(100);

    const newDemoState: DemoState = {
      hasRun: true,
      addedAppointments: bookingsToAdd.length,
      addedRevenue: addedRev,
      addedAppointmentIds: [], // never created any real rows
    };
    setDemoState(newDemoState);
    saveDemoState(newDemoState);

    setCurrentStep(DEMO_STEPS.length);
    setDemoComplete(true);
    setDemoRunning(false);

    toast.success("Demo uitgevoerd — er is niets echt verstuurd of ingepland.", {
      description: `${bookingsToAdd.length} afspraken & ${formatEuro(addedRev)} gesimuleerd`,
    });
  }, [user, demoRunning, demoMode, emptySlots]);

  // === RESET DEMO ===
  const resetDemo = useCallback(async () => {
    if (!demoMode) {
      toast.error("Deze actie is alleen beschikbaar in demo modus.");
      return;
    }
    // Defensive cleanup — older demo runs may still have row IDs persisted.
    for (const id of demoState.addedAppointmentIds) {
      try { await removeAppointment(id); } catch (e) { console.warn("demo cleanup skipped", e); }
    }

    const resetState: DemoState = { hasRun: false, addedAppointments: 0, addedRevenue: 0, addedAppointmentIds: [] };
    setDemoState(resetState);
    saveDemoState(resetState);
    setActionLog([]);
    setDemoComplete(false);
    setCurrentStep(-1);
    setDemoProgress(0);

    if (demoState.addedAppointmentIds.length > 0) {
      await refetchAppointments();
    }
    toast.success("Demo opnieuw geladen 🔄");
  }, [demoMode, demoState.addedAppointmentIds, removeAppointment, refetchAppointments]);

  // Auto-run when enabled — never auto-run during demo mode.
  // The runner itself lives in useAutoRevenueRunner so this card and the
  // 🔥 Auto Revenue page produce identical DB writes.
  useEffect(() => {
    if (demoMode) return;
    if (autopilot.enabled && user && !running && ready) {
      const lastRunKey = autopilotLastRunKey(demoMode);
      const lastRun = localStorage.getItem(lastRunKey);
      if (!lastRun || lastRun !== todayStr) {
        localStorage.setItem(lastRunKey, todayStr);
        const timer = setTimeout(() => runAutopilot(), 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [autopilot.enabled, user, todayStr, demoMode, runAutopilot, running, ready]);

  return (
    <div id="auto-revenue-engine" className="glass-card p-6 mb-6 opacity-0 animate-fade-in-up border border-primary/20 relative overflow-hidden" style={{ animationDelay: '50ms' }}>
      <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-accent/5 pointer-events-none" />
      <div className="relative">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Omzet Autopilot</h2>
              <p className="text-[11px] text-muted-foreground">GlowSuite verdient actief geld voor je</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground hidden sm:inline">Autopilot</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${autopilot.enabled ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}>
                {autopilot.enabled ? "AAN" : "UIT"}
              </span>
            </div>
            <Switch checked={autopilot.enabled} onCheckedChange={toggleAutopilot} />
          </div>
        </div>

        {/* Live Insights */}
        <div className="space-y-2.5 mb-4">
          {demoComplete ? (
            <>
              <p className="text-sm flex items-start gap-2">
                <span className="text-success font-semibold">✅</span>
                <span><span className="font-semibold text-success">{formatEuro(demoState.addedRevenue)}</span> extra omzet gegenereerd</span>
              </p>
              <p className="text-sm flex items-start gap-2">
                <span className="text-success font-semibold">📅</span>
                <span><span className="font-semibold text-success">{demoState.addedAppointments}</span> afspraken automatisch gevuld</span>
              </p>
            </>
          ) : (
            <>
              <p className="text-sm flex items-start gap-2">
                <span className="text-primary font-semibold">⚡</span>
                <span>GlowSuite kan vandaag <span className="font-semibold text-primary">{formatEuro(emptySlots * 65)}</span> extra omzet voor je genereren</span>
              </p>
              <p className="text-sm flex items-start gap-2">
                <span className="text-warning font-semibold">👥</span>
                <span>{inactiveCustomers.length} klanten klaar voor een comeback-actie</span>
              </p>
            </>
          )}
          <p className="text-sm flex items-start gap-2">
            <span className="font-semibold">📅</span>
            <span>Bezettingsgraad vandaag: <span className="font-semibold">{totalSlots > 0 ? Math.round((todaysAppts.length / totalSlots) * 100) : 0}%</span> — {emptySlots > 0 ? `${emptySlots} plekken te vullen` : 'volledig gevuld!'}</span>
          </p>
        </div>

        {/* Auto Revenue conversion metrics */}
        <AutoRevenueMetrics />

        {/* Summary cards: gevonden / acties / verwacht / uplift */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <div className="p-3 rounded-xl bg-secondary/50 border border-border">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Vandaag gevonden</p>
            <p className="text-base font-semibold">{emptySlots} <span className="text-xs font-normal text-muted-foreground">lege plekken</span></p>
          </div>
          <div className="p-3 rounded-xl bg-secondary/50 border border-border">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Acties uitgevoerd</p>
            <p className="text-base font-semibold">{totalActions}</p>
          </div>
          <div className="p-3 rounded-xl bg-success/10 border border-success/20">
            <p className="text-[10px] uppercase tracking-wider text-success/80 mb-1">Verwachte omzet</p>
            <p className="text-base font-semibold text-success">{formatEuro(projectedExtraRevenue)}</p>
          </div>
          <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
            <p className="text-[10px] uppercase tracking-wider text-primary/80 mb-1">Potentiële uplift</p>
            <p className="text-base font-semibold text-primary">{formatEuro(emptySlots * avgServicePrice)}</p>
          </div>
        </div>

        {/* Autopilot decisions (scoring) */}
        {scoredDecisions.length > 0 && (
          <div className="mb-4 p-4 rounded-xl bg-secondary/40 border border-primary/15">
            <div className="flex items-center justify-between mb-2 gap-2">
              <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                Autopilot decisions · top {scoredDecisions.length}
              </p>
              <span className="text-[11px] font-semibold text-success whitespace-nowrap">
                Verwachte omzet +{formatEuro(projectedExtraRevenue)}
              </span>
            </div>
            <div className="space-y-1.5">
              {scoredDecisions.map((d, i) => (
                <div key={i} className="flex items-start gap-2 text-xs p-2 rounded-lg bg-background/60">
                  <span className="font-semibold text-primary tabular-nums w-10 shrink-0">
                    {d.score.toFixed(0)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">
                      {d.startsAt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
                      {" · "}
                      <span className="text-primary">{ACTION_LABELS[d.action]}</span>
                      {" · +"}{formatEuro(d.projectedRevenue)}
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      <span className="font-medium">Waarom deze actie?</span> {d.reason}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Demo Progress Steps */}
        {demoRunning && currentStep >= 0 && (
          <div className="mb-4 p-4 rounded-xl bg-secondary/50 border border-primary/20 space-y-3">
            <Progress value={demoProgress} className="h-2" />
            <div className="space-y-1.5">
              {DEMO_STEPS.map((step, i) => (
                <div key={i} className={`flex items-center gap-2 text-sm transition-all duration-300 ${
                  i < currentStep ? 'text-success' :
                  i === currentStep ? 'text-primary font-medium' :
                  'text-muted-foreground/40'
                }`}>
                  {i < currentStep ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-success flex-shrink-0" />
                  ) : i === currentStep ? (
                    <Loader2 className="w-3.5 h-3.5 text-primary animate-spin flex-shrink-0" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/30 flex-shrink-0" />
                  )}
                  <span>{step.label}</span>
                </div>
              ))}
              {currentStep >= DEMO_STEPS.length && (
                <div className="flex items-center gap-2 text-sm text-success font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Voltooid — afspraken staan in je agenda!</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Result Tracking */}
        {totalActions > 0 && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-3 rounded-xl bg-success/10 border border-success/20">
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingUp className="w-3.5 h-3.5 text-success" />
                <span className="text-[11px] text-success font-medium">Extra omzet</span>
              </div>
              <p className="text-lg font-bold text-success">{formatEuro(totalRevenue)}</p>
            </div>
            <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
              <div className="flex items-center gap-1.5 mb-1">
                <Activity className="w-3.5 h-3.5 text-primary" />
                <span className="text-[11px] text-primary font-medium">Afspraken gevuld</span>
              </div>
              <p className="text-lg font-bold text-primary">{totalActions}</p>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 mb-3">
          {!demoState.hasRun ? (
            <Button variant="gradient" size="sm" onClick={runDemoSequence} disabled={demoRunning}>
              {demoRunning ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Bezig...</>
              ) : (
                <><Play className="w-3.5 h-3.5" /> Laat GlowSuite mijn agenda vullen</>
              )}
            </Button>
          ) : (
            <>
              <Button variant="gradient" size="sm" onClick={runAutopilot} disabled={running || !ready}>
                {running || !ready ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                {running ? "Bezig..." : !ready ? (notReadyReason || "Gegevens laden…") : actionLabel(demoMode, "run")}
              </Button>
              <Button variant="outline" size="sm" onClick={resetDemo}>
                <RotateCcw className="w-3.5 h-3.5" /> {demoMode ? "Demo opnieuw laden" : "Reset"}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowSettings(!showSettings)}>
            <Settings2 className="w-3.5 h-3.5" /> Instellingen
          </Button>
          {actionLog.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowLog(!showLog)}>
              <Clock className="w-3.5 h-3.5" /> Log ({actionLog.length})
              {showLog ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
            </Button>
          )}
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="p-4 rounded-xl bg-secondary/50 border border-border mb-3 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Max korting</label>
                <span className="text-sm font-semibold tabular-nums">{autopilot.maxDiscount}%</span>
              </div>
              <Slider value={[autopilot.maxDiscount]} onValueChange={([v]) => updateSetting("maxDiscount", v)} min={0} max={30} step={5} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Max berichten / dag</label>
                <span className="text-sm font-semibold tabular-nums">{autopilot.maxMessagesPerDay}</span>
              </div>
              <Slider value={[autopilot.maxMessagesPerDay]} onValueChange={([v]) => updateSetting("maxMessagesPerDay", v)} min={1} max={50} step={1} />
            </div>
          </div>
        )}

        {/* Action Log */}
        {showLog && actionLog.length > 0 && (
          <div className="p-4 rounded-xl bg-secondary/50 border border-border space-y-2 max-h-48 overflow-y-auto">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Actie Log</p>
            {actionLog.map(entry => (
              <div key={entry.id} className="flex items-start gap-2 text-sm p-2 rounded-lg bg-background/50">
                <CheckCircle2 className="w-3.5 h-3.5 text-success mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium">{entry.description}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-muted-foreground">
                      {entry.timestamp.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="text-[11px] text-success font-medium">{entry.result}</span>
                    {entry.revenue > 0 && (
                      <span className="text-[11px] text-success font-semibold">+{formatEuro(entry.revenue)}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Auto Revenue offer logs */}
        {offerLogs.length > 0 && (
          <div className="p-4 rounded-xl bg-secondary/50 border border-border space-y-2 max-h-56 overflow-y-auto">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Aanbod log (laatste 10)</p>
            {offerLogs.map(o => {
              const map: Record<string, { label: string; cls: string }> = {
                sent:            { label: "Verstuurd",          cls: "bg-primary/10 text-primary border-primary/30" },
                pending_payment: { label: "Wacht op betaling", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
                paid:            { label: "Betaald",            cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
                expired:         { label: "Verlopen",           cls: "bg-muted text-muted-foreground border-border" },
                cancelled:       { label: "Geannuleerd",        cls: "bg-rose-500/10 text-rose-600 border-rose-500/30" },
                failed:          { label: "Mislukt",            cls: "bg-destructive/10 text-destructive border-destructive/30" },
              };
              const s = map[o.status] || { label: o.status, cls: "bg-muted text-muted-foreground border-border" };
              return (
                <div key={o.id} className="flex items-center justify-between text-sm p-2 rounded-lg bg-background/50">
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(o.created_at).toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
