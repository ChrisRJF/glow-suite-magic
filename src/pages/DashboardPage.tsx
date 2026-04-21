import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useCustomers, useAppointments, useServices, useCampaigns, useLeads } from "@/hooks/useSupabaseData";
import { formatEuro } from "@/lib/data";
import {
  TrendingUp, Users, Calendar, Euro, Sparkles, ArrowRight, Clock,
  Zap, BarChart3, Award, UserPlus, ChevronDown, AlertTriangle, Star, UserX, Send, RefreshCw,
} from "lucide-react";
import { AutoRevenueEngine } from "@/components/AutoRevenueEngine";
import { DailyCoach } from "@/components/DailyCoach";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";

export default function DashboardPage() {
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const { data: services } = useServices();
  const { data: campaigns } = useCampaigns();
  const { data: leads } = useLeads();
  const navigate = useNavigate();
  const [showDetails, setShowDetails] = useState(false);

  const todayStr = new Date().toISOString().split("T")[0];
  const todaysAppts = useMemo(
    () => appointments.filter((a) => a.appointment_date?.startsWith(todayStr)),
    [appointments, todayStr],
  );

  const omzetVandaag = useMemo(
    () => todaysAppts.filter((a) => a.status !== "geannuleerd").reduce((s, a) => s + (Number(a.price) || 0), 0),
    [todaysAppts],
  );

  const totalSlots = 10;
  const bezetting = totalSlots > 0 ? Math.round((todaysAppts.length / totalSlots) * 100) : 0;
  const vrijePlekken = Math.max(0, totalSlots - todaysAppts.length);

  const inactiveCustomers = customers.filter((c) => {
    const last = appointments
      .filter((a) => a.customer_id === c.id && a.status !== "geannuleerd")
      .sort((a, b) => new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime())[0];
    if (!last) return true;
    const diff = (Date.now() - new Date(last.appointment_date).getTime()) / (1000 * 60 * 60 * 24);
    return diff > 30;
  });

  const withoutNext = customers.filter((c) => {
    const future = appointments.find(
      (a) => a.customer_id === c.id && new Date(a.appointment_date) > new Date() && a.status !== "geannuleerd",
    );
    return !future;
  });
  const rebookPct = customers.length > 0 ? Math.round(((customers.length - withoutNext.length) / customers.length) * 100) : 0;

  // No-show risico morgen
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];
  const noShowRiskTomorrow = appointments.filter((a) => {
    if (!a.appointment_date?.startsWith(tomorrowStr) || a.status === "geannuleerd") return false;
    const c = customers.find((x) => x.id === a.customer_id);
    return c && ((c.no_show_count || 0) > 0 || (c.cancellation_count || 0) > 1);
  }).length;

  const aiRevenue = useMemo(() => {
    try {
      const log = JSON.parse(localStorage.getItem("glowsuite_action_log") || "[]");
      return log.reduce((s: number, e: any) => s + (e.revenue || 0), 0);
    } catch {
      return 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments]);

  const campaignRevenue = useMemo(() => {
    const successful = campaigns.filter((c) => c.status === "verzonden" || c.status === "geboekt");
    return successful.reduce((s, c) => s + (c.sent_count || 0) * 45, 0);
  }, [campaigns]);

  const messagesSent = useMemo(
    () => campaigns.filter((c) => (c.type === "whatsapp" || c.type === "sms") && c.status && c.status !== "concept").length,
    [campaigns],
  );

  const recoveredCustomers = useMemo(() => {
    return inactiveCustomers.filter((c) => {
      const futureAppt = appointments.find(
        (a) => a.customer_id === c.id && new Date(a.appointment_date) > new Date() && a.status !== "geannuleerd",
      );
      return !!futureAppt;
    }).length;
  }, [inactiveCustomers, appointments]);

  const autoFilledAppts = useMemo(() => appointments.filter((a) => a.notes?.includes("Auto-gevuld")).length, [appointments]);

  const monthlyGrowthRevenue = aiRevenue + campaignRevenue;
  const missedRevenue = vrijePlekken * 65;

  const vipCustomers = customers.filter((c) => (Number(c.total_spent) || 0) > 500);
  const newLeads = leads.filter((l) => l.status === "nieuw").length;
  const leadsConverted = leads.filter((l) => l.status === "klant_geworden" || l.status === "geboekt").length;
  const leadsConversionPct = leads.length > 0 ? Math.round((leadsConverted / leads.length) * 100) : 0;
  const leadsRevenue = leadsConverted * 65;

  // Time window context for free slots (KPI storytelling)
  const freeSlotWindow = vrijePlekken > 0 ? "tussen 13:00–17:00" : null;

  return (
    <AppLayout
      title="Overzicht"
      subtitle={new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}
    >
      {/* ═══════════ SECTION 1: VANDAAG PRIORITEIT ═══════════ */}
      <DailyCoach />

      {/* ═══════════ SECTION 2: PLANNING VANDAAG ═══════════ */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-section-title">Planning vandaag</h2>
            <p className="text-meta mt-1">
              {todaysAppts.length === 0
                ? "Nog geen afspraken ingepland"
                : `${todaysAppts.length} ${todaysAppts.length === 1 ? "afspraak" : "afspraken"} · ${formatEuro(omzetVandaag)} verwacht`}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/agenda")} className="hidden sm:inline-flex">
            Bekijk agenda <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card p-2 sm:p-3" style={{ boxShadow: "var(--shadow-sm)" }}>
          {todaysAppts.length === 0 ? (
            <div className="text-center py-10 px-4">
              <Calendar className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-medium mb-1">Geen afspraken vandaag</p>
              <p className="text-xs text-muted-foreground mb-4">
                Activeer de autopilot om automatisch lege plekken te vullen
              </p>
              <Button variant="gradient" size="sm" onClick={() => document.getElementById("auto-revenue-engine")?.scrollIntoView({ behavior: "smooth" })}>
                <Zap className="w-4 h-4" /> Vul agenda automatisch
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {todaysAppts.slice(0, 6).map((apt) => {
                const svc = services.find((s) => s.id === apt.service_id);
                const cust = customers.find((c) => c.id === apt.customer_id);
                const time = new Date(apt.appointment_date).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
                return (
                  <div
                    key={apt.id}
                    onClick={() => navigate("/agenda")}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-secondary/50 active:scale-[0.99] transition-all cursor-pointer group"
                  >
                    <div className="w-[3px] h-8 rounded-full flex-shrink-0" style={{ backgroundColor: svc?.color || "hsl(var(--primary))" }} />
                    <div className="w-12 text-[13px] font-semibold tabular-nums text-foreground">{time}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold truncate leading-tight">{cust?.name || "Klant"}</p>
                      <p className="text-[12px] text-muted-foreground truncate mt-0.5">{svc?.name || "Behandeling"}</p>
                    </div>
                    <div
                      className={`px-2 py-0.5 rounded-md text-[10px] font-semibold capitalize ${
                        apt.status === "voltooid"
                          ? "bg-success/15 text-success"
                          : apt.status === "geannuleerd"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-primary/12 text-primary"
                      }`}
                    >
                      {apt.status}
                    </div>
                  </div>
                );
              })}
              {todaysAppts.length > 6 && (
                <button onClick={() => navigate("/agenda")} className="w-full py-2.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                  +{todaysAppts.length - 6} meer afspraken
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ═══════════ SECTION 3: VANDAAG OMZET & KPI ═══════════ */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-section-title">Vandaag in cijfers</h2>
            <p className="text-meta mt-1">Live signalen uit je salon</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/rapporten?type=omzet")} className="hidden sm:inline-flex">
            Bekijk rapport <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Omzet vandaag — hero KPI */}
          <button
            onClick={() => navigate("/rapporten?type=omzet")}
            className="text-left p-4 sm:p-5 rounded-2xl border border-border/70 bg-card hover:border-primary/30 hover:-translate-y-0.5 transition-all sm:col-span-2 lg:col-span-2 group"
            style={{ boxShadow: "var(--shadow-sm)" }}
          >
            <div className="flex items-center gap-2 mb-2.5">
              <Euro className="w-4 h-4 text-success" />
              <span className="text-eyebrow">Omzet vandaag</span>
            </div>
            <p className="text-metric text-foreground">
              <AnimatedCounter value={omzetVandaag} format={(n) => formatEuro(n)} />
            </p>
            <p className="text-meta mt-2">
              {todaysAppts.length} {todaysAppts.length === 1 ? "afspraak" : "afspraken"} · {bezetting}% bezetting
              {bezetting < 60 && bezetting > 0 ? " · ruimte voor groei" : ""}
            </p>
          </button>

          {/* Vrije plekken */}
          <button
            onClick={() => navigate("/agenda")}
            className="text-left p-4 sm:p-5 rounded-2xl border border-border/70 bg-card hover:border-warning/30 hover:-translate-y-0.5 transition-all"
            style={{ boxShadow: "var(--shadow-sm)" }}
          >
            <div className="flex items-center gap-2 mb-2.5">
              <Clock className={`w-4 h-4 ${vrijePlekken > 3 ? "text-destructive" : "text-warning"}`} />
              <span className="text-eyebrow">Vrije plekken</span>
            </div>
            <p className="text-metric-sm">
              <AnimatedCounter value={vrijePlekken} />
              {vrijePlekken > 0 && (
                <span className="ml-2 text-sm font-semibold text-warning align-middle">
                  +{formatEuro(missedRevenue)} kans
                </span>
              )}
            </p>
            <p className="text-meta mt-2">
              {vrijePlekken > 0
                ? freeSlotWindow
                  ? `Kans ${freeSlotWindow}`
                  : "Open omzet vandaag"
                : "Agenda is vol — sterk werk"}
            </p>
          </button>

          {/* No-show risico morgen */}
          <button
            onClick={() => navigate("/whatsapp")}
            className="text-left p-4 sm:p-5 rounded-2xl border border-border/70 bg-card hover:border-destructive/30 hover:-translate-y-0.5 transition-all"
            style={{ boxShadow: "var(--shadow-sm)" }}
          >
            <div className="flex items-center gap-2 mb-2.5">
              <AlertTriangle className={`w-4 h-4 ${noShowRiskTomorrow > 0 ? "text-destructive" : "text-success"}`} />
              <span className="text-eyebrow">No-show risico</span>
            </div>
            <p className="text-metric-sm">
              {noShowRiskTomorrow > 0 ? (
                <AnimatedCounter value={noShowRiskTomorrow} />
              ) : (
                <span className="text-success">0</span>
              )}
            </p>
            <p className="text-meta mt-2">
              {noShowRiskTomorrow > 0
                ? `Stuur extra herinnering voor morgen`
                : "Perfecte planning voor morgen"}
            </p>
          </button>
        </div>
      </section>

      {/* ═══════════ BELOW THE FOLD: Autopilot + ROI ═══════════ */}

      {/* Auto Revenue Engine */}
      <section data-tour="auto-revenue" id="auto-revenue-engine">
        <AutoRevenueEngine />
      </section>

      {/* GlowSuite ROI — secondary */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-success" />
            <h2 className="text-card-title">GlowSuite ROI</h2>
          </div>
          {monthlyGrowthRevenue > 0 && (
            <span className="text-xs bg-success/15 text-success px-2.5 py-1 rounded-lg font-semibold">
              +{formatEuro(monthlyGrowthRevenue)} deze maand
            </span>
          )}
        </div>
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 p-3 rounded-2xl border border-border/70 bg-card"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          <button
            onClick={() => document.getElementById("auto-revenue-engine")?.scrollIntoView({ behavior: "smooth" })}
            className="text-left p-3 rounded-xl hover:bg-success/5 transition-colors"
          >
            <p className="text-lg font-bold text-success tabular-nums">{formatEuro(aiRevenue)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">AI omzet</p>
          </button>
          <button onClick={() => navigate("/whatsapp")} className="text-left p-3 rounded-xl hover:bg-primary/5 transition-colors">
            <p className="text-lg font-bold text-primary tabular-nums">{formatEuro(campaignRevenue)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Campagnes · {messagesSent}</p>
          </button>
          <button onClick={() => navigate("/klanten?filter=risico")} className="text-left p-3 rounded-xl hover:bg-warning/5 transition-colors">
            <p className="text-lg font-bold text-warning tabular-nums">{recoveredCustomers}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Teruggewonnen</p>
          </button>
          <button onClick={() => navigate("/agenda")} className="text-left p-3 rounded-xl hover:bg-accent/5 transition-colors">
            <p className="text-lg font-bold text-accent tabular-nums">{autoFilledAppts}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Auto-gevuld</p>
          </button>
        </div>
      </section>

      {/* Meer inzichten — collapsed by default */}
      <section>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${showDetails ? "rotate-180" : ""}`} />
          Meer inzichten
        </button>

        {showDetails && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in-up">
            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Klantwaarde</h3>
              </div>
              <div className="space-y-2">
                <button onClick={() => navigate("/klanten?filter=vip")} className="w-full flex items-center justify-between text-sm hover:text-primary transition-colors">
                  <span className="flex items-center gap-1.5">
                    <Star className="w-3 h-3 text-warning" /> VIP
                  </span>
                  <span className="font-semibold tabular-nums">{vipCustomers.length}</span>
                </button>
                <button onClick={() => navigate("/klanten?filter=risico")} className="w-full flex items-center justify-between text-sm hover:text-primary transition-colors">
                  <span className="flex items-center gap-1.5">
                    <UserX className="w-3 h-3 text-destructive" /> Inactief
                  </span>
                  <span className="font-semibold tabular-nums">{inactiveCustomers.length}</span>
                </button>
              </div>
            </div>

            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <UserPlus className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Leads</h3>
              </div>
              <div className="space-y-2">
                <button onClick={() => navigate("/leads")} className="w-full flex items-center justify-between text-sm hover:text-primary transition-colors">
                  <span>Nieuw</span>
                  <span className="font-semibold tabular-nums">{newLeads}</span>
                </button>
                <button onClick={() => navigate("/leads")} className="w-full flex items-center justify-between text-sm hover:text-primary transition-colors">
                  <span>Geconverteerd</span>
                  <span className="font-semibold tabular-nums text-success">{leadsConverted}</span>
                </button>
                <button onClick={() => navigate("/leads")} className="w-full flex items-center justify-between text-sm hover:text-primary transition-colors">
                  <span>Conversie</span>
                  <span className="font-semibold tabular-nums">{leadsConversionPct}%</span>
                </button>
              </div>
            </div>

            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <RefreshCw className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Herboeken</h3>
              </div>
              <div className="mb-3">
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="text-muted-foreground text-xs">Score</span>
                  <span className="font-semibold tabular-nums">{rebookPct}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div className="h-1.5 rounded-full bg-success transition-all" style={{ width: `${rebookPct}%` }} />
                </div>
              </div>
              <Button variant="ghost" size="sm" className="w-full justify-start h-7 text-xs px-2" onClick={() => navigate("/herboekingen")}>
                <Send className="w-3 h-3" /> Herboek voorstellen
              </Button>
            </div>

            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-success" />
                <h3 className="text-sm font-semibold">Acties</h3>
              </div>
              <div className="space-y-1.5">
                <Button variant="ghost" size="sm" className="w-full justify-start h-8 text-xs" onClick={() => navigate("/whatsapp")}>
                  <Send className="w-3 h-3" /> WhatsApp campagne
                </Button>
                <Button variant="ghost" size="sm" className="w-full justify-start h-8 text-xs" onClick={() => navigate("/marketing")}>
                  <TrendingUp className="w-3 h-3" /> Marketing
                </Button>
                <Button variant="ghost" size="sm" className="w-full justify-start h-8 text-xs" onClick={() => navigate("/eigenaar")}>
                  <BarChart3 className="w-3 h-3" /> Eigenaar overzicht
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>
    </AppLayout>
  );
}
