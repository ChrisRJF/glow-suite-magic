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
import { useCustomers, useAppointments, useCampaigns, useServices } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { useDemoMode } from "@/hooks/useDemoMode";
import { actionLogKey, autopilotLastRunKey, autopilotStateKey, clearLegacyDemoLocalState, demoStateKey } from "@/lib/demoIsolation";
import { formatEuro } from "@/lib/data";
import { actionLabel, simulateDemoAction } from "@/lib/demoMode";
import {
  pickTopSlots,
  rankCustomers,
  buildActionMessage,
  ACTION_LABELS,
  type ScoredSlot,
  type AutopilotAction,
} from "@/lib/autopilotScoring";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  const { data: customers } = useCustomers();
  const { data: appointments, refetch: refetchAppointments } = useAppointments();
  const { data: campaigns, refetch: refetchCampaigns } = useCampaigns();
  const { data: services } = useServices();
  const { insert: insertCampaign } = useCrud("campaigns");
  const { insert: insertDiscount } = useCrud("discounts");
  const { insert: insertRebook } = useCrud("rebook_actions");
  // removeAppointment kept only for defensive cleanup of legacy demo rows.
  const { remove: removeAppointment } = useCrud("appointments");

  const [autopilot, setAutopilot] = useState(() => getAutopilotState(demoMode));
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);
  const [offerLogs, setOfferLogs] = useState<Array<{ id: string; status: string; created_at: string }>>([]);
  const [showLog, setShowLog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [running, setRunning] = useState(false);

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

  const todaysAppts = useMemo(() =>
    appointments.filter(a => a.appointment_date?.startsWith(todayStr) && a.status !== "geannuleerd"),
    [appointments, todayStr]
  );

  const emptySlots = Math.max(0, totalSlots - todaysAppts.length);

  // Average service price as expected revenue per slot.
  const avgServicePrice = useMemo(() => {
    const prices = services.map((s: any) => Number(s.price) || 0).filter(p => p > 0);
    if (prices.length === 0) return 55;
    return Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  }, [services]);

  // Synthesize empty slot times for today (9:00–18:00, excluding booked hours).
  const scoredDecisions = useMemo<ScoredSlot[]>(() => {
    const now = new Date();
    const busyHours = new Set(
      todaysAppts
        .map(a => {
          const t = a.start_time || (a.appointment_date ? new Date(a.appointment_date).toTimeString().slice(0, 5) : null);
          return t ? Number(t.split(":")[0]) : null;
        })
        .filter((h): h is number => h != null),
    );
    const slots: { startsAt: Date; expectedRevenue: number }[] = [];
    for (let h = 9; h <= 18; h++) {
      if (busyHours.has(h)) continue;
      const d = new Date(now);
      d.setHours(h, 0, 0, 0);
      if (d.getTime() < now.getTime() - 3_600_000) continue; // skip past
      slots.push({ startsAt: d, expectedRevenue: avgServicePrice });
    }
    return pickTopSlots(slots, 5, now);
  }, [todaysAppts, avgServicePrice]);

  const projectedExtraRevenue = useMemo(
    () => scoredDecisions.reduce((s, d) => s + d.projectedRevenue, 0),
    [scoredDecisions],
  );

  const rankedCustomers = useMemo(() => {
    const signals = customers.map((c: any) => {
      const last = appointments
        .filter(a => a.customer_id === c.id && a.status !== "geannuleerd")
        .sort((a, b) => new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime())[0];
      return {
        id: c.id,
        name: c.name,
        total_spent: c.total_spent,
        no_show_count: c.no_show_count,
        lastVisitAt: last ? new Date(last.appointment_date) : null,
      };
    });
    return rankCustomers(signals);
  }, [customers, appointments]);

  const inactiveCustomers = useMemo(() =>
    customers.filter(c => {
      const last = appointments
        .filter(a => a.customer_id === c.id && a.status !== "geannuleerd")
        .sort((a, b) => new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime())[0];
      if (!last) return true;
      return (Date.now() - new Date(last.appointment_date).getTime()) / (1000 * 60 * 60 * 24) > 30;
    }),
    [customers, appointments]
  );



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

  const addLog = (entry: Omit<ActionLogEntry, "id" | "timestamp">) => {
    setActionLog(prev => [{
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    }, ...prev].slice(0, 50));
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

  // === AUTOPILOT ===
  const runAutopilot = useCallback(async () => {
    if (!user || running) return;
    setRunning(true);

    // Persist run + decisions to autopilot_runs/autopilot_decisions in BOTH modes.
    // Demo rows are isolated via is_demo + RLS — they never affect live tables.
    const expectedTotal = scoredDecisions.reduce((s, d) => s + d.projectedRevenue, 0);
    let runId: string | null = null;
    try {
      const { data: runRow } = await supabase
        .from("autopilot_runs")
        .insert({
          user_id: user.id,
          run_type: demoMode ? "demo" : "manual",
          status: demoMode ? "simulated" : "executed",
          started_at: new Date().toISOString(),
          expected_revenue_cents: Math.round(expectedTotal * 100),
          actions_count: 0,
          is_demo: demoMode,
        })
        .select("id")
        .single();
      runId = (runRow as any)?.id ?? null;

      if (runId && scoredDecisions.length > 0) {
        await supabase.from("autopilot_decisions").insert(
          scoredDecisions.map((d) => ({
            user_id: user.id,
            run_id: runId,
            slot_date: d.startsAt.toISOString().slice(0, 10),
            slot_time: d.startsAt.toTimeString().slice(0, 8),
            action: d.action,
            score: Number(d.score.toFixed(2)),
            fill_probability: Number(d.fillProbability.toFixed(3)),
            expected_revenue_cents: Math.round(d.projectedRevenue * 100),
            urgency_multiplier: Number(d.urgencyMultiplier.toFixed(2)),
            reason: d.reason,
            status: demoMode ? "simulated" : "suggested",
            is_demo: demoMode,
          })) as any,
        );
      }
    } catch (e) {
      console.warn("autopilot run logging failed", e);
    }

    // Demo mode: simulate only. Do NOT write to campaigns/discounts/rebooks/appointments.
    if (demoMode) {
      simulateDemoAction("Omzet Autopilot scoring", {
        decisions: scoredDecisions.length,
        projected: projectedExtraRevenue,
      });
      if (scoredDecisions.length === 0) {
        addLog({
          type: "demo",
          description: "Geen winstgevende lege plekken gevonden — geen actie",
          result: "Skipped",
          revenue: 0,
        });
      }
      for (const d of scoredDecisions) {
        addLog({
          type: "demo",
          description: `${ACTION_LABELS[d.action]} · ${d.startsAt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })} — ${d.reason}`,
          result: `Score ${d.score.toFixed(0)}`,
          revenue: d.projectedRevenue,
        });
      }
      if (runId) {
        await supabase
          .from("autopilot_runs")
          .update({
            finished_at: new Date().toISOString(),
            actions_count: scoredDecisions.length,
            actual_revenue_cents: 0,
          })
          .eq("id", runId);
      }
      setRunning(false);
      return;
    }

    let actionsRun = 0;
    let actualRevenue = 0;
    const errors: string[] = [];
    const bookingLink = `${window.location.origin}/boek`;

    // Guard 1: WhatsApp must be enabled to perform any messaging actions.
    let whatsappEnabled = false;
    try {
      const { data: ws } = await supabase
        .from("whatsapp_settings")
        .select("enabled")
        .eq("user_id", user.id)
        .maybeSingle();
      whatsappEnabled = Boolean((ws as any)?.enabled);
    } catch (e) {
      console.warn("whatsapp_settings lookup failed", e);
    }

    // Guard 2: customers already messaged today by autopilot — never message twice/day.
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    let messagedTodayIds = new Set<string>();
    try {
      const { data: logs } = await supabase
        .from("autopilot_action_logs")
        .select("customer_id")
        .eq("user_id", user.id)
        .eq("is_demo", false)
        .gte("created_at", todayStart.toISOString());
      messagedTodayIds = new Set(
        (logs || [])
          .map((l: any) => l.customer_id)
          .filter((id: string | null): id is string => Boolean(id)),
      );
    } catch (e) {
      console.warn("autopilot dedupe lookup failed", e);
    }

    try {
      if (scoredDecisions.length === 0) {
        toast("Geen winstgevende lege plekken vandaag — geen actie 👍");
        setRunning(false);
        return;
      }

      if (!whatsappEnabled) {
        toast.warning("WhatsApp is uitgeschakeld — autopilot heeft geen berichten verstuurd.", {
          description: "Schakel WhatsApp in via Instellingen om autopilot acties uit te voeren.",
        });
        setRunning(false);
        return;
      }

      // Group decisions by action so we batch one campaign per action type.
      const grouped: Record<AutopilotAction, ScoredSlot[]> = {
        waitlist_offer: [],
        whatsapp_blast: [],
        discount_offer: [],
        do_nothing: [],
      };
      for (const d of scoredDecisions) grouped[d.action].push(d);

      // FK safety + dedupe: only customers from loaded set, not yet messaged today.
      const validIds = new Set(customers.map(c => c.id));
      const topTargets = rankedCustomers
        .map(rc => rc.customer)
        .filter(c => validIds.has(c.id) && !messagedTodayIds.has(c.id))
        .slice(0, Math.max(1, autopilot.maxMessagesPerDay));

      for (const action of ["waitlist_offer", "whatsapp_blast", "discount_offer"] as AutopilotAction[]) {
        const decisions = grouped[action];
        if (decisions.length === 0) continue;

        const avgHours = decisions.reduce((s, d) => s + d.hoursUntil, 0) / decisions.length;
        const projected = decisions.reduce((s, d) => s + d.projectedRevenue, 0);
        const message = buildActionMessage(action, {
          hoursUntil: avgHours,
          bookingLink,
          discountPct: autopilot.maxDiscount,
        });

        if (action === "discount_offer" && autopilot.maxDiscount > 0) {
          const disc = await insertDiscount({
            title: `Auto: ${autopilot.maxDiscount}% korting (lage vulkans)`,
            type: "percentage",
            value: autopilot.maxDiscount,
            is_active: true,
          });
          if (disc) {
            actionsRun++;
            addLog({
              type: "discount",
              description: `Korting actie · ${decisions.length} plek(ken) · ${decisions[0].reason}`,
              result: `Verwacht +${formatEuro(projected)}`,
              revenue: 0,
            });
          } else {
            errors.push("korting kon niet worden aangemaakt");
          }
        }

        const audience = action === "waitlist_offer"
          ? `Wachtlijst (${decisions.length} plek)`
          : `${topTargets.length} top klanten`;

        const result = await insertCampaign({
          title: `Auto: ${ACTION_LABELS[action]} - ${new Date().toLocaleDateString("nl-NL")}`,
          type: "whatsapp",
          status: "verzonden",
          audience,
          sent_count: action === "waitlist_offer" ? decisions.length : topTargets.length,
          message,
        });

        if (!result) {
          errors.push(`${ACTION_LABELS[action]} campagne mislukt`);
          continue;
        }

        actionsRun++;
        actualRevenue += projected;
        addLog({
          type: action === "waitlist_offer" ? "rebook" : "campaign",
          description: `${ACTION_LABELS[action]} · ${decisions.length} plek(ken) · ${decisions[0].reason}`,
          result: `Score ${decisions[0].score.toFixed(0)}`,
          revenue: projected,
        });

        // For whatsapp_blast: attach rebook actions to ranked customers (FK-safe).
        if (action === "whatsapp_blast") {
          for (const c of topTargets.slice(0, decisions.length)) {
            const r = await insertRebook({
              customer_id: c.id,
              status: "verzonden",
              suggested_date: new Date(Date.now() + 86_400_000).toISOString(),
            });
            if (!r) errors.push(`rebook voor ${c.name || c.id} mislukt`);
            // Log per-customer action so future runs dedupe within the same day.
            if (runId) {
              try {
                await supabase.from("autopilot_action_logs").insert({
                  user_id: user.id,
                  run_id: runId,
                  customer_id: c.id,
                  action,
                  status: r ? "executed" : "failed",
                  message,
                  expected_revenue_cents: Math.round((decisions[0]?.projectedRevenue || 0) * 100),
                  is_demo: false,
                } as any);
                messagedTodayIds.add(c.id);
              } catch (err) {
                console.warn("autopilot action log insert failed", err);
              }
            }
          }
        }
      }

      await refetchCampaigns();

      if (actionsRun === 0 && errors.length === 0) {
        toast("Geen actie nodig — agenda ziet er goed uit 👍");
      } else if (errors.length === 0) {
        toast.success(`Autopilot uitgevoerd — verwachte omzet +${formatEuro(actualRevenue)} 🚀`);
      } else if (actionsRun > 0) {
        toast.warning(`Autopilot deels gelukt (${actionsRun} actie(s))`, {
          description: errors.join(" · "),
        });
      } else {
        toast.error("Autopilot kon geen acties uitvoeren", {
          description: errors.join(" · "),
        });
      }
    } catch (e) {
      console.error("Autopilot error", e);
      toast.error("Autopilot kon niet alles uitvoeren — probeer het opnieuw.");
    } finally {
      if (runId) {
        try {
          await supabase
            .from("autopilot_runs")
            .update({
              finished_at: new Date().toISOString(),
              actions_count: actionsRun,
              actual_revenue_cents: Math.round(actualRevenue * 100),
              status: actionsRun > 0 ? "executed" : "failed",
            })
            .eq("id", runId);
        } catch (err) {
          console.warn("autopilot run finalize failed", err);
        }
      }
      setRunning(false);
    }
  }, [user, running, demoMode, scoredDecisions, projectedExtraRevenue, rankedCustomers, customers, autopilot, insertCampaign, insertDiscount, insertRebook, refetchCampaigns]);

  // Auto-run when enabled — never auto-run during demo mode.
  useEffect(() => {
    if (demoMode) return;
    if (autopilot.enabled && user && !running && customers.length > 0) {
      const lastRunKey = autopilotLastRunKey(demoMode);
      const lastRun = localStorage.getItem(lastRunKey);
      if (!lastRun || lastRun !== todayStr) {
        localStorage.setItem(lastRunKey, todayStr);
        const timer = setTimeout(() => runAutopilot(), 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [autopilot.enabled, user, customers.length, todayStr, demoMode, runAutopilot, running]);

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
              <Button variant="gradient" size="sm" onClick={runAutopilot} disabled={running}>
                <Zap className="w-3.5 h-3.5" /> {running ? "Bezig..." : actionLabel(demoMode, "run")}
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
      </div>
    </div>
  );
}
