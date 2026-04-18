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
import { formatEuro } from "@/lib/data";
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

const STORAGE_KEY = "glowsuite_autopilot";
const DEMO_STATE_KEY = "glowsuite_demo_state";

function getAutopilotState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  // Default ON for new users
  return { enabled: true, maxDiscount: 15, maxMessagesPerDay: 10 };
}

function saveAutopilotState(state: any) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getDemoState(): DemoState {
  try {
    const raw = localStorage.getItem(DEMO_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { hasRun: false, addedAppointments: 0, addedRevenue: 0, addedAppointmentIds: [] };
}

function saveDemoState(state: DemoState) {
  localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(state));
  // Also persist to action log for KPI
  try {
    const log = JSON.parse(localStorage.getItem("glowsuite_action_log") || "[]");
    // Remove old demo entries
    const filtered = log.filter((e: any) => e.type !== "demo");
    if (state.addedRevenue > 0) {
      filtered.push({ type: "demo", revenue: state.addedRevenue, timestamp: new Date().toISOString() });
    }
    localStorage.setItem("glowsuite_action_log", JSON.stringify(filtered));
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
  const { data: customers } = useCustomers();
  const { data: appointments, refetch: refetchAppointments } = useAppointments();
  const { data: campaigns, refetch: refetchCampaigns } = useCampaigns();
  const { data: services } = useServices();
  const { insert: insertCampaign } = useCrud("campaigns");
  const { insert: insertDiscount } = useCrud("discounts");
  const { insert: insertRebook } = useCrud("rebook_actions");
  const { insert: insertAppointment } = useCrud("appointments");
  const { remove: removeAppointment } = useCrud("appointments");

  const [autopilot, setAutopilot] = useState(getAutopilotState);
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [running, setRunning] = useState(false);

  // Demo flow state
  const [demoState, setDemoState] = useState<DemoState>(getDemoState);
  const [demoRunning, setDemoRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [demoProgress, setDemoProgress] = useState(0);
  const [demoComplete, setDemoComplete] = useState(false);

  const todayStr = new Date().toISOString().split("T")[0];
  const totalSlots = 10;

  const todaysAppts = useMemo(() =>
    appointments.filter(a => a.appointment_date?.startsWith(todayStr) && a.status !== "geannuleerd"),
    [appointments, todayStr]
  );

  const emptySlots = Math.max(0, totalSlots - todaysAppts.length);

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

  const withoutNext = useMemo(() =>
    customers.filter(c => !appointments.find(a =>
      a.customer_id === c.id && new Date(a.appointment_date) > new Date() && a.status !== "geannuleerd"
    )),
    [customers, appointments]
  );

  const totalRevenue = actionLog.reduce((s, e) => s + e.revenue, 0) + demoState.addedRevenue;
  const totalActions = actionLog.length + demoState.addedAppointments;

  const toggleAutopilot = (enabled: boolean) => {
    const next = { ...autopilot, enabled };
    setAutopilot(next);
    saveAutopilotState(next);
    toast.success(enabled ? "Autopilot ingeschakeld ✨" : "Autopilot uitgeschakeld");
  };

  const updateSetting = (key: string, value: number) => {
    const next = { ...autopilot, [key]: value };
    setAutopilot(next);
    saveAutopilotState(next);
  };

  const addLog = (entry: Omit<ActionLogEntry, "id" | "timestamp">) => {
    setActionLog(prev => [{
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    }, ...prev].slice(0, 50));
  };

  // === DEMO FLOW ===
  const runDemoSequence = useCallback(async () => {
    if (!user || demoRunning) return;
    setDemoRunning(true);
    setDemoComplete(false);
    setCurrentStep(-1);
    setDemoProgress(0);
    setShowLog(true);

    // Step through animated phases
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

    // Now create real appointments
    const today = new Date();
    const bookingsToAdd = DEMO_BOOKINGS.slice(0, Math.min(2, emptySlots || 2));
    const createdIds: string[] = [];
    let addedRev = 0;

    // Find matching services or use first available
    for (let i = 0; i < bookingsToAdd.length; i++) {
      const booking = bookingsToAdd[i];
      const matchService = services.find(s => s.name.toLowerCase().includes(booking.service.split(" ")[0].toLowerCase()));
      // Find matching customer or use any customer
      const matchCustomer = customers.find(c => c.name.toLowerCase().includes(booking.name.split(" ")[0].toLowerCase()))
        || customers[i];

      const hour = 14 + i; // 14:00, 15:00
      const appointmentDate = new Date(today);
      appointmentDate.setHours(hour, 0, 0, 0);

      const result = await insertAppointment({
        appointment_date: appointmentDate.toISOString(),
        customer_id: matchCustomer?.id || null,
        service_id: matchService?.id || services[0]?.id || null,
        status: "gepland",
        price: matchService?.price || booking.price,
        notes: `Auto-gevuld door AI Revenue Engine`,
      });

      if (result) {
        createdIds.push(result.id);
        const rev = Number(matchService?.price || booking.price);
        addedRev += rev;

        addLog({
          type: "demo",
          description: `${matchCustomer?.name || booking.name} → ${matchService?.name || booking.service} ingepland`,
          result: `+${formatEuro(rev)}`,
          revenue: rev,
        });
      }
    }

    // Also create a campaign record
    await insertCampaign({
      title: `AI Auto-fill: ${bookingsToAdd.length} afspraken gevuld`,
      type: "whatsapp",
      status: "verzonden",
      audience: `${bookingsToAdd.length} klanten`,
      sent_count: bookingsToAdd.length,
      message: "Hi! We hebben vandaag nog plekken beschikbaar. Boek snel! 💇‍♀️",
    });

    setDemoProgress(100);

    const newDemoState: DemoState = {
      hasRun: true,
      addedAppointments: bookingsToAdd.length,
      addedRevenue: addedRev,
      addedAppointmentIds: createdIds,
    };
    setDemoState(newDemoState);
    saveDemoState(newDemoState);

    await refetchAppointments();
    await refetchCampaigns();

    setCurrentStep(DEMO_STEPS.length);
    setDemoComplete(true);
    setDemoRunning(false);

    toast.success(`${formatEuro(addedRev)} extra omzet gegenereerd! 🎉`, {
      description: `${bookingsToAdd.length} afspraken automatisch ingepland`,
    });
  }, [user, demoRunning, emptySlots, customers, services, insertAppointment, insertCampaign, refetchAppointments, refetchCampaigns]);

  // === RESET DEMO ===
  const resetDemo = useCallback(async () => {
    // Remove created appointments
    for (const id of demoState.addedAppointmentIds) {
      await removeAppointment(id);
    }

    const resetState: DemoState = { hasRun: false, addedAppointments: 0, addedRevenue: 0, addedAppointmentIds: [] };
    setDemoState(resetState);
    saveDemoState(resetState);
    setActionLog([]);
    setDemoComplete(false);
    setCurrentStep(-1);
    setDemoProgress(0);

    await refetchAppointments();
    toast.success("Demo is gereset 🔄");
  }, [demoState.addedAppointmentIds, removeAppointment, refetchAppointments]);

  // === AUTOPILOT ===
  const runAutopilot = useCallback(async () => {
    if (!user || running) return;
    setRunning(true);

    try {
      if (emptySlots >= 3) {
        const targetCustomers = withoutNext.slice(0, Math.min(autopilot.maxMessagesPerDay, withoutNext.length));
        if (targetCustomers.length > 0) {
          const result = await insertCampaign({
            title: `Auto: Lege plekken vullen - ${new Date().toLocaleDateString("nl-NL")}`,
            type: "whatsapp",
            status: "verzonden",
            audience: `${targetCustomers.length} klanten zonder afspraak`,
            sent_count: targetCustomers.length,
            message: `Hi! We hebben vandaag nog plekken beschikbaar. Boek snel met ${autopilot.maxDiscount}% korting! 💇‍♀️`,
          });
          if (result) {
            addLog({ type: "campaign", description: `WhatsApp naar ${targetCustomers.length} klanten voor ${emptySlots} lege plekken`, result: "Verzonden", revenue: emptySlots * 45 });
            if (autopilot.maxDiscount > 0) {
              await insertDiscount({ title: `Auto korting: ${autopilot.maxDiscount}% lege plekken`, type: "percentage", value: autopilot.maxDiscount, is_active: true });
              addLog({ type: "discount", description: `${autopilot.maxDiscount}% korting geactiveerd`, result: "Actief", revenue: 0 });
            }
          }
        }
      }

      if (inactiveCustomers.length >= 3) {
        const targets = inactiveCustomers.slice(0, Math.min(5, autopilot.maxMessagesPerDay));
        const result = await insertCampaign({ title: `Auto: Comeback actie - ${new Date().toLocaleDateString("nl-NL")}`, type: "whatsapp", status: "verzonden", audience: `${targets.length} inactieve klanten`, sent_count: targets.length, message: `Hey! We missen je 💕 Boek deze week met een speciale welkom-terug korting!` });
        if (result) {
          addLog({ type: "rebook", description: `Comeback actie naar ${targets.length} inactieve klanten`, result: "Verzonden", revenue: targets.length * 55 });
          for (const c of targets.slice(0, 5)) {
            await insertRebook({ customer_id: c.id, status: "verzonden", suggested_date: new Date(Date.now() + 3 * 86400000).toISOString() });
          }
        }
      }

      await refetchCampaigns();
      if (emptySlots >= 3 || inactiveCustomers.length >= 3) {
        toast.success("Autopilot heeft acties uitgevoerd! 🚀");
      } else {
        toast("Geen actie nodig — agenda ziet er goed uit 👍");
      }
    } catch (e) {
      toast.error("Autopilot fout: " + (e instanceof Error ? e.message : "onbekend"));
    } finally {
      setRunning(false);
    }
  }, [user, running, emptySlots, withoutNext, inactiveCustomers, autopilot, insertCampaign, insertDiscount, insertRebook, refetchCampaigns]);

  // Auto-run when enabled
  useEffect(() => {
    if (autopilot.enabled && user && !running && customers.length > 0) {
      const lastRun = localStorage.getItem("glowsuite_autopilot_lastrun");
      if (!lastRun || lastRun !== todayStr) {
        localStorage.setItem("glowsuite_autopilot_lastrun", todayStr);
        const timer = setTimeout(() => runAutopilot(), 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [autopilot.enabled, user, customers.length, todayStr]);

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
                <Zap className="w-3.5 h-3.5" /> {running ? "Bezig..." : "Nu uitvoeren"}
              </Button>
              <Button variant="outline" size="sm" onClick={resetDemo}>
                <RotateCcw className="w-3.5 h-3.5" /> Demo opnieuw laden
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
