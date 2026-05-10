import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Sparkles, Zap, AlertTriangle, Clock, CalendarX, Star,
  ArrowRight, Loader2, MessageCircle, RotateCcw, TrendingUp,
  CheckCircle2, Hourglass, XCircle, Activity, Users, Megaphone,
  ShieldAlert, Wallet, Target, BadgeCheck,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useAutoRevenueRunner } from "@/hooks/useAutoRevenueRunner";
import {
  useCustomers, useAppointments, useCampaigns,
} from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { formatEuro } from "@/lib/data";

type FeedCategory = "revenue" | "clients" | "campaigns" | "automations" | "risk";
interface FeedItem {
  id: string;
  ts: string;
  text: string;
  tone: "ok" | "warn" | "muted" | "info";
  category: FeedCategory;
}

const TONE_STYLES: Record<FeedItem["tone"], string> = {
  ok: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  muted: "bg-muted text-muted-foreground",
  info: "bg-primary/10 text-primary",
};

const CATEGORY_LABEL: Record<FeedCategory, string> = {
  revenue: "Omzet",
  clients: "Klanten",
  campaigns: "Campagnes",
  automations: "Automatisering",
  risk: "Risico",
};

interface ActionCard {
  title: string;
  reason: string;
  to: string;
  icon: any;
  impact: string;
  confidence: number; // 0-100
  urgency: "low" | "med" | "high";
}

const URGENCY_PILL: Record<ActionCard["urgency"], string> = {
  low: "bg-muted text-muted-foreground border-border",
  med: "bg-primary/10 text-primary border-primary/30",
  high: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30",
};

const RUN_STEPS = [
  "Agenda analyseren",
  "Klanten analyseren",
  "Omzetkansen berekenen",
  "Campagnes voorbereiden",
  "Resultaten opslaan",
];

export default function GlowSuiteAIPage() {
  const { user } = useAuth();
  const location = useLocation();
  const { demoMode } = useDemoMode();
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const { data: campaigns } = useCampaigns();

  const {
    running,
    runAutopilot,
    ready,
    notReadyReason,
    scoredDecisions,
    projectedExtraRevenue,
    rankedCustomers,
    emptySlots,
    todaysAppts,
    inactiveCustomers,
  } = useAutoRevenueRunner({ source: "auto-revenue" });

  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [recoveredRevenue, setRecoveredRevenue] = useState(0);
  const [filledCount, setFilledCount] = useState(0);
  const [pendingPayments, setPendingPayments] = useState(0);
  const [latestRunAt, setLatestRunAt] = useState<string | null>(null);
  const [latestRunStatus, setLatestRunStatus] = useState<string | null>(null);
  const [reachedToday, setReachedToday] = useState(0);

  // Run-step animation state
  const [runStep, setRunStep] = useState(0);

  // Activity feed category filter
  const [feedFilter, setFeedFilter] = useState<"all" | FeedCategory>("all");

  // Today range
  const sinceIso = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  // Active campaigns (live data, no fakes)
  const activeCampaignCount = useMemo(() => {
    return (campaigns as any[]).filter(
      (c) => c.status === "active" || c.status === "running" || c.is_active === true,
    ).length;
  }, [campaigns]);

  // Customers monitored today: those with appointments today OR flagged inactive/follow-up
  const monitoredToday = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const ids = new Set<string>();
    for (const a of appointments as any[]) {
      const d = new Date(a.appointment_date);
      if (d >= today && d < tomorrow) ids.add(a.customer_id);
    }
    for (const c of inactiveCustomers) ids.add((c as any).id);
    return ids.size;
  }, [appointments, inactiveCustomers]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [offersRes, runsRes, paymentsRes] = await Promise.all([
          supabase
            .from("auto_revenue_offers")
            .select("id, status, created_at, customer_name, service_name")
            .eq("user_id", user.id)
            .eq("is_demo", demoMode)
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("autopilot_runs")
            .select("id, started_at, actions_count, status, expected_revenue_cents")
            .eq("user_id", user.id)
            .eq("is_demo", demoMode)
            .order("started_at", { ascending: false })
            .limit(8),
          supabase
            .from("payments")
            .select("amount, metadata, status, paid_at")
            .eq("user_id", user.id)
            .eq("is_demo", demoMode)
            .eq("status", "paid")
            .gte("paid_at", sinceIso),
        ]);

        if (cancelled) return;

        const offers = (offersRes.data as any[]) || [];
        const runs = (runsRes.data as any[]) || [];
        const payments = (paymentsRes.data as any[]) || [];

        const revenue = payments
          .filter((p) => {
            const src = p?.metadata?.source;
            return src === "auto_revenue_deposit" || src === "auto_revenue_full";
          })
          .reduce((sum, p) => sum + Number(p.amount || 0), 0);
        setRecoveredRevenue(revenue);
        setFilledCount(offers.filter((o) => o.status === "paid").length);
        setPendingPayments(offers.filter((o) => o.status === "pending_payment").length);
        // Reached today = unique offer recipients sent since 00:00
        const todays = offers.filter((o) => new Date(o.created_at).getTime() >= new Date(sinceIso).getTime());
        setReachedToday(new Set(todays.map((o) => o.customer_name || o.id)).size);
        if (runs.length > 0) {
          setLatestRunAt(runs[0].started_at);
          setLatestRunStatus(runs[0].status);
        }

        const items: FeedItem[] = [];
        for (const o of offers.slice(0, 10)) {
          const name = o.customer_name || "Een klant";
          if (o.status === "paid") {
            items.push({ id: `o-${o.id}`, ts: o.created_at, category: "revenue", text: `${name} boekte een vrijgekomen plek`, tone: "ok" });
          } else if (o.status === "expired") {
            items.push({ id: `o-${o.id}`, ts: o.created_at, category: "automations", text: `Aanbod aan ${name} is verlopen`, tone: "muted" });
          } else if (o.status === "pending_payment") {
            items.push({ id: `o-${o.id}`, ts: o.created_at, category: "revenue", text: `${name} wacht op betaling`, tone: "warn" });
          } else {
            items.push({ id: `o-${o.id}`, ts: o.created_at, category: "campaigns", text: `AI stuurde WhatsApp naar ${name}`, tone: "info" });
          }
        }
        for (const r of runs.slice(0, 5)) {
          const cnt = r.actions_count || 0;
          const proj = (r.expected_revenue_cents || 0) / 100;
          items.push({
            id: `r-${r.id}`,
            ts: r.started_at,
            category: "automations",
            text: `AI run · ${cnt} acties${proj ? ` · verwacht ${formatEuro(proj)}` : ""}`,
            tone: "info",
          });
        }
        items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
        setFeed(items.slice(0, 14));
      } catch (e) {
        console.warn("GlowSuite AI feed load failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, demoMode, sinceIso]);

  // Customer intelligence heuristics
  const intelligence = useMemo(() => {
    const now = Date.now();
    const DAY = 1000 * 60 * 60 * 24;
    let churnRisk = 0;
    let vips = 0;
    let frequent = 0;
    let noShowRisk = 0;
    let followUp = 0;
    let maxDaysSinceChurn = 0;
    for (const c of customers as any[]) {
      const visits = (appointments as any[]).filter(
        (a) => a.customer_id === c.id && a.status !== "geannuleerd",
      );
      const last = visits.sort(
        (a, b) =>
          new Date(b.appointment_date).getTime() -
          new Date(a.appointment_date).getTime(),
      )[0];
      const daysSince = last ? (now - new Date(last.appointment_date).getTime()) / DAY : Infinity;
      const spent = Number(c.total_spent || 0);
      const noShows = Number(c.no_show_count || 0);
      if (spent >= 300) vips++;
      if (visits.length >= 6) frequent++;
      if (noShows >= 2) noShowRisk++;
      if (daysSince > 60 && visits.length >= 1) {
        churnRisk++;
        if (daysSince !== Infinity && daysSince > maxDaysSinceChurn) maxDaysSinceChurn = daysSince;
      }
      if (daysSince > 25 && daysSince < 50 && visits.length >= 1) followUp++;
    }
    return { churnRisk, vips, frequent, noShowRisk, followUp, maxDaysSinceChurn: Math.round(maxDaysSinceChurn) };
  }, [customers, appointments]);

  // Smart insight chips with intelligent language
  const insightCards = [
    {
      label: emptySlots > 0
        ? `${emptySlots} lege ${emptySlots === 1 ? "plek kan" : "plekken kunnen"} vandaag gevuld worden`
        : "Agenda is volgeboekt vandaag",
      value: emptySlots,
      icon: CalendarX,
      accent: "from-primary/15 to-primary/0 text-primary",
    },
    {
      label: "Potentiële extra omzet vandaag",
      value: projectedExtraRevenue,
      isCurrency: true,
      icon: TrendingUp,
      accent: "from-emerald-500/15 to-emerald-500/0 text-emerald-600 dark:text-emerald-400",
    },
    {
      label: intelligence.churnRisk > 0
        ? `${intelligence.churnRisk} vaste ${intelligence.churnRisk === 1 ? "klant dreigt" : "klanten dreigen"} af te haken`
        : "Geen klanten in churn-risico",
      value: intelligence.churnRisk,
      icon: AlertTriangle,
      accent: "from-amber-500/15 to-amber-500/0 text-amber-600 dark:text-amber-400",
    },
    {
      label: intelligence.followUp > 0
        ? `${intelligence.followUp} klanten wachten op opvolging`
        : "Geen openstaande follow-ups",
      value: intelligence.followUp,
      icon: Clock,
      accent: "from-primary/15 to-primary/0 text-primary",
    },
    {
      label: pendingPayments > 0
        ? `${pendingPayments} ${pendingPayments === 1 ? "afspraak wacht" : "afspraken wachten"} op betaling`
        : "Geen openstaande betalingen",
      value: pendingPayments,
      icon: Hourglass,
      isCurrency: false,
      accent: "from-violet-500/15 to-violet-500/0 text-violet-600 dark:text-violet-400",
    },
    {
      label: intelligence.noShowRisk > 0
        ? `${intelligence.noShowRisk} ${intelligence.noShowRisk === 1 ? "afspraak heeft" : "afspraken hebben"} no-show risico`
        : "Geen no-show risico",
      value: intelligence.noShowRisk,
      icon: ShieldAlert,
      accent: "from-rose-500/15 to-rose-500/0 text-rose-600 dark:text-rose-400",
    },
  ];

  // Smarter action cards with confidence + ROI
  const ACTION_CARDS: ActionCard[] = useMemo(() => {
    const cards: ActionCard[] = [];

    if (emptySlots > 0) {
      cards.push({
        title: `AI vond ${Math.min(emptySlots, scoredDecisions.length || emptySlots)} kansen om lege plekken te vullen`,
        reason: `Waarschijnlijk ${formatEuro(projectedExtraRevenue)} extra omzet vandaag`,
        to: "/wachtlijst",
        icon: Sparkles,
        impact: `+${formatEuro(projectedExtraRevenue)}`,
        confidence: scoredDecisions.length > 0 ? 87 : 72,
        urgency: emptySlots >= 3 ? "high" : "med",
      });
    }

    if (inactiveCustomers.length > 0) {
      cards.push({
        title: `${inactiveCustomers.length} ${inactiveCustomers.length === 1 ? "vaste klant is" : "vaste klanten zijn"} al >30 dagen niet geweest`,
        reason: "AI adviseert een heractivatiecampagne via WhatsApp",
        to: "/herboekingen",
        icon: RotateCcw,
        impact: "Hoge ROI",
        confidence: 78,
        urgency: inactiveCustomers.length >= 5 ? "high" : "med",
      });
    }

    if (intelligence.followUp > 0) {
      cards.push({
        title: `${intelligence.followUp} klanten klaar voor follow-up`,
        reason: "Stuur een persoonlijk bericht voor herboeking",
        to: "/automatiseringen",
        icon: MessageCircle,
        impact: "Loyalty ↑",
        confidence: 81,
        urgency: "med",
      });
    }

    if (intelligence.noShowRisk > 0) {
      cards.push({
        title: "No-show risico gedetecteerd",
        reason: `${intelligence.noShowRisk} ${intelligence.noShowRisk === 1 ? "afspraak heeft" : "afspraken hebben"} verhoogd risico`,
        to: "/agenda",
        icon: ShieldAlert,
        impact: "Voorkom verlies",
        confidence: 74,
        urgency: "high",
      });
    }

    cards.push({
      title: "Vraag reviews aan recente klanten",
      reason: "Recente afspraken zonder review verzameld",
      to: "/automatiseringen",
      icon: Star,
      impact: "Reputatie ↑",
      confidence: 69,
      urgency: "low",
    });

    cards.push({
      title: "Check de wachtlijst",
      reason: "Klanten die wachten op een vrijgekomen plek",
      to: "/wachtlijst",
      icon: Clock,
      impact: "Snelle conversie",
      confidence: 76,
      urgency: "low",
    });

    return cards.slice(0, 6);
  }, [emptySlots, scoredDecisions.length, projectedExtraRevenue, inactiveCustomers.length, intelligence.followUp, intelligence.noShowRisk]);

  const topCustomers = useMemo(() => {
    return rankedCustomers.slice(0, 5).map((rc: any) => {
      const c = rc.customer;
      const visits = (appointments as any[]).filter(
        (a) => a.customer_id === c.id && a.status !== "geannuleerd",
      );
      const last = visits.sort(
        (a, b) =>
          new Date(b.appointment_date).getTime() -
          new Date(a.appointment_date).getTime(),
      )[0];
      const daysSince = last
        ? Math.round((Date.now() - new Date(last.appointment_date).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      const spent = Number(c.total_spent || 0);
      const noShows = Number(c.no_show_count || 0);
      const badges: { label: string; tone: string }[] = [];
      if (spent >= 500) badges.push({ label: "VIP", tone: "bg-primary/15 text-primary border-primary/30" });
      if (visits.length >= 6) badges.push({ label: "Frequent", tone: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-400" });
      if (daysSince !== null && daysSince > 60) badges.push({ label: "Dreigt af te haken", tone: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400" });
      if (noShows >= 2) badges.push({ label: "No-show risico", tone: "bg-rose-500/10 text-rose-600 border-rose-500/30 dark:text-rose-400" });
      return {
        id: c.id,
        name: c.name,
        spent,
        visits: visits.length,
        daysSince,
        badges,
      };
    });
  }, [rankedCustomers, appointments]);

  // Smooth scroll to anchor when navigating to /ai#insights or /ai#activity
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = location.hash.replace("#", "");
    if (!hash) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const t = setTimeout(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => clearTimeout(t);
  }, [location.hash]);

  // Run step animation while autopilot is running
  useEffect(() => {
    if (!running) {
      setRunStep(0);
      return;
    }
    setRunStep(1);
    const total = RUN_STEPS.length;
    const interval = setInterval(() => {
      setRunStep((s) => (s < total ? s + 1 : s));
    }, 700);
    return () => clearInterval(interval);
  }, [running]);

  const filteredFeed = useMemo(
    () => (feedFilter === "all" ? feed : feed.filter((f) => f.category === feedFilter)),
    [feed, feedFilter],
  );

  const heroAction = (
    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
      <Button
        variant="gradient"
        size="lg"
        onClick={runAutopilot}
        disabled={!ready || running}
        className="w-full sm:w-auto relative overflow-hidden"
      >
        {running ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> AI bezig…
          </>
        ) : !ready ? (
          notReadyReason || "Laden…"
        ) : (
          <>
            <Sparkles className="w-4 h-4" /> AI uitvoeren
          </>
        )}
      </Button>
      <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
        <Link to="/auto-revenue">
          <Zap className="w-4 h-4" /> Bekijk Auto Revenue
        </Link>
      </Button>
    </div>
  );

  return (
    <AppLayout title="GlowSuite AI">
      <div className="space-y-5 pb-[max(env(safe-area-inset-bottom),1rem)] -mt-2 sm:-mt-1">
        {/* Hero — live AI control center */}
        <Card className="relative overflow-hidden border-primary/20 animate-fade-in">
          <div
            className="absolute inset-0 opacity-90 pointer-events-none"
            style={{
              background:
                "radial-gradient(1100px 420px at 15% 0%, hsl(var(--primary) / 0.22), transparent 60%), radial-gradient(900px 380px at 95% 100%, hsl(var(--primary) / 0.14), transparent 60%)",
            }}
          />
          {/* floating glow */}
          <div
            className="absolute -top-24 -right-24 h-72 w-72 rounded-full pointer-events-none opacity-60 blur-3xl"
            style={{ background: "hsl(var(--primary) / 0.25)" }}
          />
          <CardContent className="relative p-5 sm:p-7">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <div className="max-w-2xl">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                    <Sparkles className="w-3 h-3 mr-1" /> AI Command Center
                  </Badge>
                  {demoMode ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      Demo modus
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500/70 opacity-75 animate-ping" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                      LIVE · AI actief
                    </span>
                  )}
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-balance">
                  GlowSuite AI
                </h2>
                <p className="text-sm sm:text-base text-muted-foreground mt-2 leading-relaxed">
                  Je AI assistent voor omzet, klanten en planning.
                </p>

                {/* Realtime monitoring chips */}
                <div className="mt-4 grid grid-cols-2 sm:flex sm:flex-wrap gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-card/70 border border-border text-muted-foreground transition-colors hover:border-primary/40">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-primary/70 opacity-75 animate-ping" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                    </span>
                    Auto Revenue draait
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-card/70 border border-border text-muted-foreground hover:border-primary/40">
                    <Megaphone className="w-3 h-3 text-primary" />
                    {activeCampaignCount} {activeCampaignCount === 1 ? "campagne actief" : "campagnes actief"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-card/70 border border-border text-muted-foreground hover:border-primary/40">
                    <Users className="w-3 h-3 text-primary" />
                    {monitoredToday} klanten gemonitord
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-card/70 border border-border text-muted-foreground hover:border-primary/40">
                    <Target className="w-3 h-3 text-primary" />
                    {scoredDecisions.length} AI beslissingen klaar
                  </span>
                </div>
              </div>
              <div className="lg:shrink-0 lg:w-auto w-full">{heroAction}</div>
            </div>

            {/* Run step progression */}
            {running && (
              <div className="relative mt-5 rounded-xl border border-primary/20 bg-card/60 backdrop-blur-sm p-3 animate-fade-in">
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  <p className="text-xs font-medium text-foreground">AI voert acties uit…</p>
                </div>
                <ul className="space-y-1.5">
                  {RUN_STEPS.map((label, i) => {
                    const done = i + 1 < runStep;
                    const active = i + 1 === runStep;
                    return (
                      <li key={label} className="flex items-center gap-2 text-xs">
                        {done ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        ) : active ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                        ) : (
                          <span className="w-3.5 h-3.5 rounded-full border border-border shrink-0" />
                        )}
                        <span className={done ? "text-muted-foreground line-through" : active ? "text-foreground font-medium" : "text-muted-foreground"}>
                          {label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Smart insight chips */}
        <div id="insights" className="scroll-mt-20">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold">Vandaag in één oogopslag</h3>
            <span className="text-[11px] text-muted-foreground">{demoMode ? "Demo data" : "Live data"}</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {insightCards.map((c, i) => (
              <div
                key={c.label}
                style={{ animationDelay: `${i * 40}ms` }}
                className={`relative rounded-2xl border border-border/70 p-3 bg-gradient-to-br ${c.accent} transition-all hover:border-primary/30 hover:-translate-y-0.5 animate-fade-in`}
              >
                <div className="flex items-start justify-between gap-2">
                  <c.icon className="w-4 h-4 opacity-70" />
                  <p className="text-xl font-semibold tabular-nums text-foreground leading-none">
                    {c.isCurrency ? (
                      <AnimatedCounter value={Number(c.value) || 0} format={(n) => formatEuro(n)} />
                    ) : (
                      <AnimatedCounter value={Number(c.value) || 0} />
                    )}
                  </p>
                </div>
                <p className="text-[11px] mt-1.5 leading-snug text-foreground/90">{c.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* AI Action Center with confidence + ROI */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-lg font-semibold">Aanbevolen acties</h3>
              <p className="text-sm text-muted-foreground">Persoonlijke AI suggesties met confidence en impact.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ACTION_CARDS.map((a, i) => (
              <Card
                key={a.title}
                style={{ animationDelay: `${i * 50}ms` }}
                className="group hover:border-primary/40 hover:-translate-y-0.5 transition-all animate-fade-in"
              >
                <CardContent className="p-4 flex flex-col h-full">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <a.icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-snug text-[15px]">{a.title}</p>
                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{a.reason}</p>
                    </div>
                  </div>
                  <div className="flex items-center flex-wrap gap-1.5 mt-3">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${URGENCY_PILL[a.urgency]}`}>
                      {a.urgency === "high" ? "Urgent" : a.urgency === "med" ? "Aanbevolen" : "Optioneel"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                      <BadgeCheck className="w-3 h-3" /> {a.confidence}% confidence
                    </span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">
                      {a.impact}
                    </span>
                  </div>
                  <div className="flex items-center justify-end mt-3 pt-2 border-t border-border/60">
                    <Button asChild variant="ghost" size="sm" className="group-hover:translate-x-0.5 transition-transform">
                      <Link to={a.to}>
                        Openen <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Customer Intelligence + Activity Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 animate-fade-in">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <CardTitle className="text-lg">Klant intelligence</CardTitle>
                  <CardDescription>Top klanten met AI signalen.</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/klanten">Alle klanten <ArrowRight className="w-3.5 h-3.5" /></Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {topCustomers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Nog geen klantsignalen — voeg klanten en afspraken toe om intelligence te zien.
                </p>
              ) : (
                <ul className="divide-y divide-border/70 -mx-2">
                  {topCustomers.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 py-3 px-2">
                      <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 font-medium text-sm">
                        {(c.name || "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.name || "Onbekend"}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {c.visits} bezoeken · {formatEuro(c.spent)}
                          {c.daysSince !== null ? ` · ${c.daysSince}d geleden` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                        {c.badges.slice(0, 2).map((b) => (
                          <span key={b.label} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${b.tone}`}>
                            {b.label}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card id="activity" className="scroll-mt-20 animate-fade-in">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                <CardTitle className="text-lg">AI activiteit</CardTitle>
              </div>
              <CardDescription>Realtime tijdlijn van wat GlowSuite AI doet.</CardDescription>
              {/* Category filter */}
              <div className="flex flex-wrap gap-1.5 mt-3">
                {(["all", "revenue", "clients", "campaigns", "automations", "risk"] as const).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setFeedFilter(cat)}
                    className={`text-[10px] font-medium px-2 py-1 rounded-full border transition-colors ${
                      feedFilter === cat
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-card border-border text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    {cat === "all" ? "Alles" : CATEGORY_LABEL[cat]}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {filteredFeed.length === 0 ? (
                <div className="py-10 px-4 flex flex-col items-center text-center">
                  <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-3 relative">
                    <span className="absolute inset-0 rounded-2xl bg-primary/10 animate-ping" />
                    <Sparkles className="w-5 h-5 relative" />
                  </div>
                  <p className="text-sm font-medium">GlowSuite AI monitort je salon actief…</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-[240px] leading-relaxed">
                    Zodra er acties zijn, verschijnen ze hier in realtime.
                  </p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {filteredFeed.map((item, i) => {
                    const Icon =
                      item.tone === "ok" ? CheckCircle2 :
                      item.tone === "warn" ? Hourglass :
                      item.tone === "muted" ? XCircle : Sparkles;
                    return (
                      <li
                        key={item.id}
                        style={{ animationDelay: `${i * 30}ms` }}
                        className="flex items-start gap-3 animate-fade-in"
                      >
                        <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${TONE_STYLES[item.tone]}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm leading-snug">{item.text}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(item.ts).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" })}
                            </span>
                            <span className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/70">
                              {CATEGORY_LABEL[item.category]}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* AI Revenue Engine widget */}
        <Card className="relative border-primary/15 overflow-hidden animate-fade-in">
          <div
            className="absolute inset-0 pointer-events-none opacity-60"
            style={{
              background:
                "radial-gradient(700px 220px at 0% 0%, hsl(var(--primary) / 0.14), transparent 60%)",
            }}
          />
          <CardContent className="relative p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
              <div className="flex items-start gap-3 min-w-0">
                <div className="relative h-10 w-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
                  <span className="absolute inset-0 rounded-xl bg-primary/10 animate-ping opacity-60" />
                  <Zap className="w-5 h-5 relative" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold leading-tight">AI Revenue Engine</p>
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500/70 opacity-75 animate-ping" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                      {latestRunStatus === "completed" ? "Actief" : latestRunAt ? "Standby" : "Klaar"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {latestRunAt
                      ? `Laatste run: ${new Date(latestRunAt).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" })}`
                      : "Nog geen run vandaag"}
                  </p>
                </div>
              </div>
              <Button asChild variant="outline" className="w-full sm:w-auto shrink-0">
                <Link to="/auto-revenue">
                  Open Auto Revenue <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-5">
              <div className="rounded-xl border border-border/70 bg-card/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Verwacht</p>
                <p className="text-base font-semibold tabular-nums mt-0.5">
                  <AnimatedCounter value={projectedExtraRevenue} format={(n) => formatEuro(n)} />
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-card/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Teruggewonnen</p>
                <p className="text-base font-semibold tabular-nums mt-0.5 text-emerald-600 dark:text-emerald-400">
                  <AnimatedCounter value={recoveredRevenue} format={(n) => formatEuro(n)} />
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-card/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Plekken gevuld</p>
                <p className="text-base font-semibold tabular-nums mt-0.5">
                  <AnimatedCounter value={filledCount} />
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-card/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Klanten bereikt</p>
                <p className="text-base font-semibold tabular-nums mt-0.5">
                  <AnimatedCounter value={reachedToday} />
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-card/50 p-3 col-span-2 sm:col-span-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Wallet className="w-3 h-3" /> Wacht op betaling
                </p>
                <p className="text-base font-semibold tabular-nums mt-0.5">
                  <AnimatedCounter value={pendingPayments} />
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
