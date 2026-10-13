import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCustomers, useAppointments, useServices, useCampaigns, useLeads, usePaymentRefunds } from "@/hooks/useSupabaseData";
import { usePayments } from "@/hooks/usePayments";
import { calculateNoShowRisk } from "@/lib/noShowRisk";
import { formatEuro } from "@/lib/data";
import { amsterdamDateKey, buildReports, rangeForPreset, trendClass, trendLabel } from "@/lib/reporting";
import {
  TrendingUp, Users, Calendar, Euro, Sparkles, ArrowRight, Clock,
  Zap, BarChart3, Award, UserPlus, ChevronDown, AlertTriangle, Star, UserX, Send, RefreshCw,
  CheckCircle2, Crown,
} from "lucide-react";
import { AutoRevenueEngine } from "@/components/AutoRevenueEngine";
import { DailyCoach } from "@/components/DailyCoach";
import { TodayBriefing } from "@/components/TodayBriefing";
import { RevenueOpportunities } from "@/components/RevenueOpportunities";
import { TodayAtAGlance } from "@/components/TodayAtAGlance";
import { WhyHint } from "@/components/WhyHint";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { PremiumOwnerMetrics } from "@/components/PremiumOwnerMetrics";
import { useDemoMode } from "@/hooks/useDemoMode";
import { BeautycareWelcomeCard } from "@/components/demo/BeautycareWelcomeCard";

import { actionLogKey, clearLegacyDemoLocalState } from "@/lib/demoIsolation";
import { cn } from "@/lib/utils";
import { countNewCustomersThisWeek, nextDateKey, safeAmsterdamDateKey } from "@/lib/calendarWeek";
import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

export default function DashboardPage() {
  const { data: customers, loading: customersLoading } = useCustomers();
  const { data: appointments, loading: appointmentsLoading } = useAppointments();
  const { data: services, loading: servicesLoading } = useServices();
  const { data: campaigns } = useCampaigns();
  const { data: leads } = useLeads();
  const { data: payments, loading: paymentsLoading } = usePayments();
  const { data: refunds, loading: refundsLoading } = usePaymentRefunds();
  const { demoMode } = useDemoMode();
  const navigate = useNavigate();
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    clearLegacyDemoLocalState();
  }, []);

  const reportRange = useMemo(() => rangeForPreset("deze_maand"), []);
  const report = useMemo(() => buildReports({ appointments, customers, services, payments, refunds, mode: demoMode ? "demo" : "live", from: reportRange.from, to: reportRange.to }), [appointments, customers, services, payments, refunds, demoMode, reportRange.from, reportRange.to]);
  const loading = customersLoading || appointmentsLoading || servicesLoading || paymentsLoading || refundsLoading;

  const todayStr = amsterdamDateKey(new Date());
  const todaysAppts = useMemo(
    () => report.rows.appointments.filter((a) => safeAmsterdamDateKey(a.appointment_date) === todayStr),
    [report.rows.appointments, todayStr],
  );

  const omzetVandaag = report.revenue.today;

  const newCustomersThisWeek = useMemo(() => countNewCustomersThisWeek(report.rows.customers ?? customers), [report.rows.customers, customers]);

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
  const tomorrowStr = nextDateKey(todayStr);
  const noShowRiskTomorrowAppts = report.rows.appointments.filter((a) => {
    if (safeAmsterdamDateKey(a.appointment_date) !== tomorrowStr || a.status === "geannuleerd") return false;
    const c = customers.find((x) => x.id === a.customer_id);
    return c ? calculateNoShowRisk(c).isElevated : false;
  });
  const noShowRiskTomorrow = noShowRiskTomorrowAppts.length;
  const firstNoShowRiskTomorrowId = [...noShowRiskTomorrowAppts]
    .sort((a, b) => String(a.appointment_date).localeCompare(String(b.appointment_date)))[0]?.id as string | undefined;

  const aiRevenue = useMemo(() => {
    try {
      const log = JSON.parse(localStorage.getItem(actionLogKey(demoMode)) || "[]");
      return log.reduce((s: number, e: any) => s + (e.revenue || 0), 0);
    } catch {
      return 0;
    }
  }, [appointments, demoMode]);

  const paidRevenueThisMonth = report.revenue.month;

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

  const monthlyGrowthRevenue = paidRevenueThisMonth;
  const membershipRevenue = payments.filter((p: any) => p.payment_type === "membership" && p.status === "paid").reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);

  const vipCustomers = customers.filter((c) => (Number(c.total_spent) || 0) > 500);
  const newLeads = leads.filter((l) => l.status === "nieuw").length;
  const openActions = noShowRiskTomorrow + newLeads + inactiveCustomers.length;
  const leadsConverted = leads.filter((l) => l.status === "klant_geworden" || l.status === "geboekt").length;
  const leadsConversionPct = leads.length > 0 ? Math.round((leadsConverted / leads.length) * 100) : 0;
  const leadsRevenue = leadsConverted * 65;

  return (
    <div data-mobile-dashboard className="contents">
    <AppLayout
      title="Overzicht"
      subtitle={new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}
    >
      <div className="space-y-5">
        <BeautycareWelcomeCard />



        <section aria-labelledby="planning-vandaag">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 id="planning-vandaag" className="text-section-title">Planning vandaag</h2>
              <p className="text-meta mt-0.5">
                {todaysAppts.length === 0
                  ? "Nog geen afspraken"
                  : `${todaysAppts.length} ${todaysAppts.length === 1 ? "afspraak" : "afspraken"} · ${formatEuro(omzetVandaag)} betaald`}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate("/agenda")}>
              Open agenda <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>

          <div className="rounded-xl border border-border/70 bg-card p-2 sm:p-3" style={{ boxShadow: "var(--shadow-sm)" }}>
            {todaysAppts.length === 0 ? (
              <div className="text-center py-8 px-4">
                <Calendar className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm font-medium">Je agenda is vandaag nog leeg</p>
                <Button variant="gradient" size="sm" className="mt-3" onClick={() => navigate("/agenda?nieuw=1")}>
                  <Calendar className="w-4 h-4" /> Afspraak maken
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {todaysAppts.slice(0, 6).map((apt, idx) => {
                  const svc = services.find((s) => s.id === apt.service_id);
                  const cust = customers.find((c) => c.id === apt.customer_id);
                  const time = new Date(apt.appointment_date).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
                  return (
                    <button
                      key={apt.id}
                      onClick={() => navigate(`/agenda?afspraak=${apt.id}`)}
                      className={cn("w-full items-center gap-3 rounded-lg px-3 py-2.5 sm:py-3 text-left",  idx >= 3 ? "hidden sm:flex" : "flex", " hover:bg-secondary/50 transition-colors group")}
                      aria-label={`Open afspraak van ${cust?.name || "klant"} om ${time}`}
                    >
                      <span className="w-12 text-[13px] font-semibold tabular-nums">{time}</span>
                      <span className="w-[3px] self-stretch rounded-full" style={{ backgroundColor: svc?.color || "hsl(var(--primary))" }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{cust?.name || "Klant"}</span>
                        <span className="block truncate text-xs text-muted-foreground">{svc?.name || "Behandeling"}</span>
                      </span>
                      <span className="hidden text-xs font-medium text-muted-foreground group-hover:text-primary sm:inline">Open afspraak</span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                    </button>
                  );
                })}
                <button
                  onClick={() => navigate("/agenda")}
                  className="flex sm:hidden w-full items-center justify-center gap-1 px-3 py-2.5 text-sm font-medium text-primary"
                >
                  Bekijk alle afspraken <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      <section>
        <div className="flex items-end justify-between mb-3 sm:mb-4">
          <div>
            <h2 className="text-section-title">Omzet en cijfers</h2>
            <p className="text-meta mt-1">Uit je agenda, klanten en betalingen</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/rapporten?type=omzet")} className="hidden sm:inline-flex">
            Bekijk rapport <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 sm:h-36 rounded-2xl" />)}
          </div>
        ) : (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2.5 sm:gap-4">
          {/* Omzet vandaag — hero KPI */}
          <button
            onClick={() => navigate("/rapporten?type=omzet")}
            className="text-left p-4 sm:p-5 rounded-2xl border border-border/70 bg-card hover:border-primary/30 hover:-translate-y-0.5 transition-all col-span-2 lg:col-span-2 group"
            style={{ boxShadow: "var(--shadow-sm)" }}
          >
            <div className="flex items-center gap-2 mb-2.5">
              <Euro className="w-4 h-4 text-success" />
              <span className="text-eyebrow">Omzet vandaag (betaald)</span>
            </div>
            <p className="text-metric text-foreground">
              <AnimatedCounter value={omzetVandaag} format={(n) => formatEuro(n)} />
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-meta">
                {todaysAppts.length} {todaysAppts.length === 1 ? "afspraak" : "afspraken"}
              </span>
            </div>
          </button>

          <DashboardKpi icon={Calendar} label="Afspraken vandaag" value={String(report.appointments.today)} trend={trendLabel(report.appointments.trend)} trendValue={report.appointments.trend} onClick={() => navigate("/agenda")} />
          <DashboardKpi icon={UserPlus} label="Nieuwe klanten deze week" value={String(newCustomersThisWeek)} trend="ma t/m zo" onClick={() => navigate("/klanten")} />
          <DashboardKpi icon={RefreshCw} label="Herhaalboekingen" value={`${rebookPct}%`} trend="retentie" onClick={() => navigate("/herboekingen")} />
          <DashboardKpi icon={Crown} label="Abonnement omzet" value={formatEuro(membershipRevenue)} trend="recurring" onClick={() => navigate("/abonnementen")} />
          <DashboardKpi icon={AlertTriangle} label="Open acties" value={String(openActions)} trend="vandaag" compactMobile onClick={() => navigate("/acties")} />

          {/* No-show risico */}
          <button
            onClick={() => navigate("/whatsapp")}
            className="hidden sm:block self-start sm:self-auto text-left p-3 sm:p-5 rounded-2xl border border-border/70 bg-card hover:border-destructive/30 hover:-translate-y-0.5 transition-all"
            style={{ boxShadow: "var(--shadow-sm)" }}
          >
            <div className="flex items-start sm:items-center gap-2 mb-1.5 sm:mb-2.5">
              <AlertTriangle className={`w-4 h-4 ${noShowRiskTomorrow > 0 ? "text-destructive" : "text-success"}`} />
              <span className="text-eyebrow leading-snug">No-show risico morgen</span>
            </div>
            <p className="text-metric-sm">
              {noShowRiskTomorrow > 0 ? (
                <AnimatedCounter value={noShowRiskTomorrow} />
              ) : (
                <span className="text-success">0</span>
              )}
            </p>
            <div className="mt-1.5 sm:mt-2 space-y-1 sm:space-y-1.5">
              {noShowRiskTomorrow > 0 ? (
                <>
                  <span className="inline-block text-[11px] font-bold text-destructive bg-destructive/10 px-2 py-0.5 rounded-md">
                    Stuur herinnering voor morgen
                  </span>
                  <WhyHint>Klanten met eerdere no-shows of annuleringen zijn morgen ingepland.</WhyHint>
                </>
              ) : (
                <span className="inline-block text-[11px] font-bold text-success bg-success/10 px-2 py-0.5 rounded-md">
                  Perfecte planning morgen ✓
                </span>
              )}
            </div>
          </button>
        </div>
        )}
      </section>

      <section className="rounded-2xl border border-border/50 bg-card/60 px-4 py-3 sm:px-5 sm:py-3.5" style={{ boxShadow: "var(--shadow-sm)" }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
          <div className="space-y-1 min-w-0">
            <h2 className="text-[15px] sm:text-base font-medium tracking-tight text-foreground/90">
              {formatEuro(report.revenue.week)} omzet in de laatste 7 dagen
            </h2>
            <p className="text-[12px] text-muted-foreground/80">Op basis van betaalde betalingen.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/rapporten?type=omzet")} className="self-start sm:self-auto -ml-2 sm:ml-0">
            Bekijk groei <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
      </section>

      <TodayBriefing title="Vandaag aandacht nodig" showEmptyState />

      <TodayAtAGlance mobileNoShowRiskTomorrow={noShowRiskTomorrow} mobileNoShowRiskTomorrowId={firstNoShowRiskTomorrowId} />

      <RevenueOpportunities />

      <section data-tour="auto-revenue" id="auto-revenue-engine">
        <AutoRevenueEngine />
        <p className="sm:hidden mt-2 text-xs leading-relaxed text-muted-foreground">
          Verwachte omzet is de raming voor voorgestelde acties. Extra omzet is het resultaat uit het actielog{demoMode ? " en de demosimulatie, geen betaalde omzet" : ", niet hetzelfde als betaalde omzet"}.
        </p>
      </section>

      {/* Meer inzichten — secundaire overzichten, standaard ingeklapt */}
      <section>
        <button
          onClick={() => setShowDetails(!showDetails)}
          aria-expanded={showDetails}
          className="flex w-full items-center justify-between gap-2 rounded-xl border border-border/70 bg-card px-4 py-3 text-sm font-medium text-foreground/80 hover:text-foreground hover:border-primary/30 transition-colors"
        >
          <span className="text-left">
            Meer inzichten
            <span className="block text-[12px] font-normal text-muted-foreground">Premium overzicht, dagcoach, ROI, klantwaarde en leads</span>
          </span>
          <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${showDetails ? "rotate-180" : ""}`} />
        </button>

        {showDetails && (
          <div className="mt-5 space-y-7 animate-fade-in-up">
          <PremiumOwnerMetrics />

          <DailyCoach />

          <section>
            <div className="flex items-center justify-between gap-2 mb-4">
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
              <button onClick={() => navigate("/rapporten?type=omzet")} className="text-left p-3 rounded-xl hover:bg-primary/5 transition-colors">
                <p className="text-lg font-bold text-primary tabular-nums">{formatEuro(paidRevenueThisMonth)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Betaald deze maand · {messagesSent}</p>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
          </div>
        )}
      </section>
    </AppLayout>
    </div>
  );
}

function DashboardKpi({ icon: Icon, label, value, trend, trendValue, onClick, compactMobile = false }: { icon: React.ElementType; label: string; value: string; trend: string; trendValue?: number; onClick: () => void; compactMobile?: boolean }) {
  return (
    <button onClick={onClick} className={cn("min-w-0 text-left sm:p-5 rounded-2xl border border-border/70 bg-card hover:border-primary/30 hover:-translate-y-0.5 transition-all", compactMobile ? "self-start sm:self-auto p-3" : "p-3.5")} style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className={cn("flex items-start gap-2 sm:mb-2.5", compactMobile ? "mb-1.5" : "mb-2.5")}>
        <Icon className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
        <span className="text-eyebrow leading-snug">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className="text-metric-sm break-words">{value}</p>
        <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-md flex-shrink-0", typeof trendValue === "number" ? trendClass(trendValue) : "text-muted-foreground bg-secondary/50")}>{trend}</span>
      </div>
    </button>
  );
}
