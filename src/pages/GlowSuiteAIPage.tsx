import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Sparkles, Bot, Zap, Users, AlertTriangle, Clock, CalendarX, Star,
  ArrowRight, Loader2, MessageCircle, Gift, RotateCcw, TrendingUp,
  CheckCircle2, Hourglass, XCircle, Activity,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useAutoRevenueRunner } from "@/hooks/useAutoRevenueRunner";
import { useCustomers, useAppointments } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { formatEuro } from "@/lib/data";

interface FeedItem {
  id: string;
  ts: string;
  text: string;
  tone: "ok" | "warn" | "muted" | "info";
}

const TONE_STYLES: Record<FeedItem["tone"], string> = {
  ok: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  muted: "bg-muted text-muted-foreground",
  info: "bg-primary/10 text-primary",
};

interface ActionCard {
  title: string;
  reason: string;
  to: string;
  icon: any;
  impact: string;
}

export default function GlowSuiteAIPage() {
  const { user } = useAuth();
  const location = useLocation();
  const { demoMode } = useDemoMode();
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();

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

  // Today range
  const sinceIso = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

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
            .limit(15),
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
        if (runs.length > 0) {
          setLatestRunAt(runs[0].started_at);
          setLatestRunStatus(runs[0].status);
        }

        // Combine into one chronological feed
        const items: FeedItem[] = [];
        for (const o of offers.slice(0, 8)) {
          const name = o.customer_name || "Een klant";
          if (o.status === "paid") {
            items.push({ id: `o-${o.id}`, ts: o.created_at, text: `${name} boekte een vrijgekomen plek`, tone: "ok" });
          } else if (o.status === "expired") {
            items.push({ id: `o-${o.id}`, ts: o.created_at, text: `Aanbod aan ${name} is verlopen`, tone: "muted" });
          } else if (o.status === "pending_payment") {
            items.push({ id: `o-${o.id}`, ts: o.created_at, text: `${name} wacht op betaling`, tone: "warn" });
          } else {
            items.push({ id: `o-${o.id}`, ts: o.created_at, text: `Aanbod verstuurd naar ${name}`, tone: "info" });
          }
        }
        for (const r of runs.slice(0, 5)) {
          const cnt = r.actions_count || 0;
          const proj = (r.expected_revenue_cents || 0) / 100;
          items.push({
            id: `r-${r.id}`,
            ts: r.started_at,
            text: `AI run · ${cnt} acties${proj ? ` · verwacht ${formatEuro(proj)}` : ""}`,
            tone: "info",
          });
        }
        items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
        setFeed(items.slice(0, 12));
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
      if (daysSince > 60 && visits.length >= 1) churnRisk++;
      if (daysSince > 25 && daysSince < 50 && visits.length >= 1) followUp++;
    }
    return { churnRisk, vips, frequent, noShowRisk, followUp };
  }, [customers, appointments]);

  const insightCards = [
    { label: "Potentiële extra omzet", value: formatEuro(projectedExtraRevenue), icon: TrendingUp, accent: "from-emerald-500/15 to-emerald-500/0 text-emerald-600 dark:text-emerald-400" },
    { label: "Lege plekken vandaag", value: emptySlots, icon: CalendarX, accent: "from-primary/15 to-primary/0 text-primary" },
    { label: "Churn risico klanten", value: intelligence.churnRisk, icon: AlertTriangle, accent: "from-amber-500/15 to-amber-500/0 text-amber-600 dark:text-amber-400" },
    { label: "Follow-ups klaar", value: intelligence.followUp, icon: Clock, accent: "from-primary/15 to-primary/0 text-primary" },
    { label: "Wacht op betaling", value: pendingPayments, icon: Hourglass, accent: "from-violet-500/15 to-violet-500/0 text-violet-600 dark:text-violet-400" },
    { label: "No-show risico", value: intelligence.noShowRisk, icon: XCircle, accent: "from-rose-500/15 to-rose-500/0 text-rose-600 dark:text-rose-400" },
  ];

  const ACTION_CARDS: ActionCard[] = [
    { title: "Vul lege plekken", reason: `${emptySlots} open uren vandaag`, to: "/wachtlijst", icon: Sparkles, impact: `Tot ${formatEuro(projectedExtraRevenue)} extra` },
    { title: "Heractiveer klanten", reason: `${inactiveCustomers.length} klanten >30 dagen weg`, to: "/herboekingen", icon: RotateCcw, impact: "Hoge ROI" },
    { title: "Verstuur follow-up", reason: `${intelligence.followUp} klanten klaar voor follow-up`, to: "/automatiseringen", icon: MessageCircle, impact: "Loyalty ↑" },
    { title: "Vraag reviews aan", reason: "Recente afspraken zonder review", to: "/automatiseringen", icon: Star, impact: "Reputatie ↑" },
    { title: "Check wachtlijst", reason: "Klanten die wachten op een plek", to: "/wachtlijst", icon: Clock, impact: "Snelle conversie" },
  ];

  const topCustomers = useMemo(() => {
    return rankedCustomers.slice(0, 6).map((rc: any) => {
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
      if (spent >= 1000) badges.push({ label: "Hoge besteding", tone: "bg-primary/15 text-primary border-primary/30" });
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

  const heroAction = (
    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
      <Button
        variant="gradient"
        size="lg"
        onClick={runAutopilot}
        disabled={!ready || running}
        className="w-full sm:w-auto"
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
        <Link to="/automatiseringen">
          <Bot className="w-4 h-4" /> Automatiseringen
        </Link>
      </Button>
    </div>
  );

  return (
    <AppLayout
      title="GlowSuite AI"
      subtitle="Je AI assistent voor omzet, klanten en planning."
    >
      <div className="space-y-7">
        {/* Hero */}
        <Card className="relative overflow-hidden border-primary/20">
          <div
            className="absolute inset-0 opacity-80 pointer-events-none"
            style={{
              background:
                "radial-gradient(1000px 400px at 20% 0%, hsl(var(--primary) / 0.18), transparent 60%), radial-gradient(800px 360px at 90% 100%, hsl(var(--primary) / 0.12), transparent 60%)",
            }}
          />
          <CardContent className="relative p-6 sm:p-8">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <div className="max-w-2xl">
                <Badge variant="outline" className="mb-3 border-primary/30 bg-primary/10 text-primary">
                  <Sparkles className="w-3 h-3 mr-1" /> AI Command Center
                </Badge>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-balance">
                  Eén intelligente assistent voor je hele salon.
                </h2>
                <p className="text-sm sm:text-base text-muted-foreground mt-2 leading-relaxed">
                  GlowSuite AI vult lege plekken, heractiveert klanten en stuurt slimme campagnes — automatisch.
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-full bg-card/60 border border-border text-muted-foreground">
                    {scoredDecisions.length} AI beslissingen klaar
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-card/60 border border-border text-muted-foreground">
                    {todaysAppts.length} afspraken vandaag
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-card/60 border border-border text-muted-foreground">
                    {inactiveCustomers.length} klanten inactief
                  </span>
                </div>
              </div>
              <div className="lg:shrink-0 lg:w-auto w-full">{heroAction}</div>
            </div>
          </CardContent>
        </Card>

        {/* Today insight grid */}
        <div id="insights" className="scroll-mt-20">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">Vandaag in één oogopslag</h3>
            <span className="text-xs text-muted-foreground">{demoMode ? "Demo data" : "Live"}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {insightCards.map((c) => (
              <div
                key={c.label}
                className={`relative rounded-2xl border border-border/70 p-4 bg-gradient-to-br ${c.accent} transition-all hover:border-primary/30`}
              >
                <c.icon className="w-4 h-4 mb-2 opacity-70" />
                <p className="text-[10px] uppercase tracking-wider font-medium opacity-80 leading-tight">{c.label}</p>
                <p className="text-2xl font-semibold tabular-nums mt-1 text-foreground">{c.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* AI Action Center */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-lg font-semibold">AI acties</h3>
              <p className="text-sm text-muted-foreground">Slimme suggesties op basis van je salon vandaag.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ACTION_CARDS.map((a) => (
              <Card key={a.title} className="group hover:border-primary/40 transition-all">
                <CardContent className="p-5 flex flex-col h-full">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <a.icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-tight">{a.title}</p>
                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{a.desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/60">
                    <span className="text-[11px] font-medium text-primary">{a.impact}</span>
                    <Button asChild variant="ghost" size="sm">
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
          <Card className="lg:col-span-2">
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

          <Card id="activity" className="scroll-mt-20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                <CardTitle className="text-lg">Wat AI deed</CardTitle>
              </div>
              <CardDescription>De recentste acties.</CardDescription>
            </CardHeader>
            <CardContent>
              {feed.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Nog geen activiteit. Klik op "AI uitvoeren" om te starten.
                </p>
              ) : (
                <ul className="space-y-3">
                  {feed.map((item) => {
                    const Icon =
                      item.tone === "ok" ? CheckCircle2 :
                      item.tone === "warn" ? Hourglass :
                      item.tone === "muted" ? XCircle : Sparkles;
                    return (
                      <li key={item.id} className="flex items-start gap-3">
                        <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${TONE_STYLES[item.tone]}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm leading-snug">{item.text}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(item.ts).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" })}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Auto Revenue integration footer */}
        <Card className="border-primary/15 bg-gradient-to-br from-primary/5 to-transparent">
          <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div className="flex items-start sm:items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <p className="font-semibold leading-tight">Auto Revenue draait op de achtergrond</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Vandaag teruggewonnen: {formatEuro(recoveredRevenue)} · {filledCount} plekken gevuld
                </p>
              </div>
            </div>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/auto-revenue">
                Open Auto Revenue <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
