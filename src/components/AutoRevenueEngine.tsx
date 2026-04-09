import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Zap, MessageCircle, CalendarPlus, TrendingUp, Clock,
  Settings2, ChevronDown, ChevronUp, Activity, CheckCircle2
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCustomers, useAppointments, useCampaigns } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { formatEuro } from "@/lib/data";
import { toast } from "sonner";

interface ActionLogEntry {
  id: string;
  timestamp: Date;
  type: "campaign" | "discount" | "rebook";
  description: string;
  result: string;
  revenue: number;
}

const STORAGE_KEY = "glowsuite_autopilot";

function getAutopilotState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { enabled: false, maxDiscount: 15, maxMessagesPerDay: 10 };
}

function saveAutopilotState(state: any) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function AutoRevenueEngine() {
  const { user } = useAuth();
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const { data: campaigns, refetch: refetchCampaigns } = useCampaigns();
  const { insert: insertCampaign } = useCrud("campaigns");
  const { insert: insertDiscount } = useCrud("discounts");
  const { insert: insertRebook } = useCrud("rebook_actions");

  const [autopilot, setAutopilot] = useState(getAutopilotState);
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [running, setRunning] = useState(false);

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

  const totalRevenue = actionLog.reduce((s, e) => s + e.revenue, 0);
  const totalActions = actionLog.length;

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

  const runAutopilot = useCallback(async () => {
    if (!user || running) return;
    setRunning(true);

    try {
      // Action 1: Fill empty slots with campaign
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
            addLog({
              type: "campaign",
              description: `WhatsApp naar ${targetCustomers.length} klanten voor ${emptySlots} lege plekken`,
              result: "Verzonden",
              revenue: emptySlots * 45,
            });

            // Also create discount
            if (autopilot.maxDiscount > 0) {
              await insertDiscount({
                title: `Auto korting: ${autopilot.maxDiscount}% lege plekken`,
                type: "percentage",
                value: autopilot.maxDiscount,
                is_active: true,
              });
              addLog({
                type: "discount",
                description: `${autopilot.maxDiscount}% korting geactiveerd voor lege plekken`,
                result: "Actief",
                revenue: 0,
              });
            }
          }
        }
      }

      // Action 2: Inactive customer comeback
      if (inactiveCustomers.length >= 3) {
        const targets = inactiveCustomers.slice(0, Math.min(5, autopilot.maxMessagesPerDay));
        const result = await insertCampaign({
          title: `Auto: Comeback actie - ${new Date().toLocaleDateString("nl-NL")}`,
          type: "whatsapp",
          status: "verzonden",
          audience: `${targets.length} inactieve klanten`,
          sent_count: targets.length,
          message: `Hey! We missen je 💕 Boek deze week met een speciale welkom-terug korting!`,
        });
        if (result) {
          addLog({
            type: "rebook",
            description: `Comeback actie naar ${targets.length} inactieve klanten`,
            result: "Verzonden",
            revenue: targets.length * 55,
          });

          // Create rebook actions
          for (const c of targets.slice(0, 5)) {
            await insertRebook({
              customer_id: c.id,
              status: "verzonden",
              suggested_date: new Date(Date.now() + 3 * 86400000).toISOString(),
            });
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

  // Auto-run when enabled (once per session load)
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
    <div className="glass-card p-6 mb-6 opacity-0 animate-fade-in-up border border-primary/20 relative overflow-hidden" style={{ animationDelay: '50ms' }}>
      <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-accent/5 pointer-events-none" />
      <div className="relative">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">AI Revenue Engine</h2>
              <p className="text-[11px] text-muted-foreground">Automatische omzet optimalisatie</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{autopilot.enabled ? "Actief" : "Uit"}</span>
            <Switch checked={autopilot.enabled} onCheckedChange={toggleAutopilot} />
          </div>
        </div>

        {/* Live Insights */}
        <div className="space-y-2.5 mb-4">
          <p className="text-sm flex items-start gap-2">
            <span className="text-destructive font-semibold">⚡</span>
            <span>Je mist <span className="font-semibold text-destructive">{formatEuro(emptySlots * 65)}</span> omzet vandaag door lege plekken</span>
          </p>
          <p className="text-sm flex items-start gap-2">
            <span className="text-warning font-semibold">👥</span>
            <span>{inactiveCustomers.length} klanten zijn overdue voor een nieuwe afspraak</span>
          </p>
          <p className="text-sm flex items-start gap-2">
            <span className="text-warning font-semibold">📅</span>
            <span>Bezettingsgraad vandaag: <span className="font-semibold">{totalSlots > 0 ? Math.round((todaysAppts.length / totalSlots) * 100) : 0}%</span></span>
          </p>
        </div>

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
                <span className="text-[11px] text-primary font-medium">Acties uitgevoerd</span>
              </div>
              <p className="text-lg font-bold text-primary">{totalActions}</p>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 mb-3">
          {autopilot.enabled ? (
            <Button variant="gradient" size="sm" onClick={runAutopilot} disabled={running}>
              <Zap className="w-3.5 h-3.5" /> {running ? "Bezig..." : "Nu uitvoeren"}
            </Button>
          ) : (
            <>
              <Button variant="gradient" size="sm" onClick={runAutopilot} disabled={running}>
                <Zap className="w-3.5 h-3.5" /> {running ? "Bezig..." : "Eenmalig uitvoeren"}
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
              <Slider
                value={[autopilot.maxDiscount]}
                onValueChange={([v]) => updateSetting("maxDiscount", v)}
                min={0} max={30} step={5}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Max berichten / dag</label>
                <span className="text-sm font-semibold tabular-nums">{autopilot.maxMessagesPerDay}</span>
              </div>
              <Slider
                value={[autopilot.maxMessagesPerDay]}
                onValueChange={([v]) => updateSetting("maxMessagesPerDay", v)}
                min={1} max={50} step={1}
              />
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
