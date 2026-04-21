import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useCustomers, useAppointments, useServices, useCampaigns } from "@/hooks/useSupabaseData";
import { formatEuro } from "@/lib/data";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import {
  TrendingUp, TrendingDown, Users, Award, AlertTriangle, Target, Calendar, Euro,
  ArrowRight, Lightbulb, Sparkles, Crown,
} from "lucide-react";

export default function EigenaarPage() {
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const { data: services } = useServices();
  const { data: campaigns } = useCampaigns();
  const navigate = useNavigate();

  const metrics = useMemo(() => {
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
    const prevWeekStart = new Date(now); prevWeekStart.setDate(now.getDate() - 14);
    const next7End = new Date(now); next7End.setDate(now.getDate() + 7);

    const isPaid = (a: any) => a.status !== "geannuleerd";

    const thisWeek = appointments.filter(a => isPaid(a) && new Date(a.appointment_date) >= weekStart && new Date(a.appointment_date) <= now);
    const prevWeek = appointments.filter(a => isPaid(a) && new Date(a.appointment_date) >= prevWeekStart && new Date(a.appointment_date) < weekStart);
    const upcoming = appointments.filter(a => isPaid(a) && new Date(a.appointment_date) > now && new Date(a.appointment_date) <= next7End);

    const revThis = thisWeek.reduce((s, a) => s + (Number(a.price) || 0), 0);
    const revPrev = prevWeek.reduce((s, a) => s + (Number(a.price) || 0), 0);
    const growth = revPrev > 0 ? Math.round(((revThis - revPrev) / revPrev) * 100) : (revThis > 0 ? 100 : 0);
    const expectedNext = upcoming.reduce((s, a) => s + (Number(a.price) || 0), 0);

    const svcRevenue = services.map(s => {
      const aps = thisWeek.filter(a => a.service_id === s.id);
      return { svc: s, count: aps.length, revenue: aps.reduce((sum, a) => sum + (Number(a.price) || 0), 0) };
    }).sort((a, b) => b.revenue - a.revenue);
    const topService = svcRevenue[0];

    const totalSlotsWeek = 7 * 10;
    const bezetting = Math.round((thisWeek.length / totalSlotsWeek) * 100);

    const noShows = appointments.filter(a => a.status === "geannuleerd" && new Date(a.appointment_date) >= weekStart);
    const noShowLoss = noShows.reduce((s, a) => s + (Number(a.price) || 0), 0);

    const churnRisk = customers.filter(c => {
      const last = appointments
        .filter(a => a.customer_id === c.id && a.status !== "geannuleerd")
        .sort((a, b) => new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime())[0];
      if (!last) return false;
      const days = (Date.now() - new Date(last.appointment_date).getTime()) / 86400000;
      return days > 60 && days < 180 && (Number(c.total_spent) || 0) > 100;
    });

    // Loss without action: empty slots next 7d × avg + churn risk × avg LTV slice
    const avgPrice = services.length > 0 ? services.reduce((s, x) => s + Number(x.price || 0), 0) / services.length : 65;
    const remainingSlotsWeek = Math.max(0, totalSlotsWeek - upcoming.length);
    const lossWithoutAction = Math.round(remainingSlotsWeek * avgPrice * 0.4 + churnRisk.length * 80);

    // Biggest opportunity
    const opportunities: { label: string; value: number; route: string }[] = [];
    if (remainingSlotsWeek > 0) opportunities.push({ label: `${remainingSlotsWeek} lege plekken vullen komende week`, value: Math.round(remainingSlotsWeek * avgPrice * 0.4), route: "/agenda" });
    if (churnRisk.length > 0) opportunities.push({ label: `${churnRisk.length} klanten win-back campagne`, value: churnRisk.length * 80, route: "/klanten?filter=risico" });
    if (topService) opportunities.push({ label: `Promoot ${topService.svc.name}`, value: Math.round(topService.revenue * 0.3), route: "/marketing" });
    const biggestOpp = opportunities.sort((a, b) => b.value - a.value)[0];

    // Best campaign ROI
    const sentCampaigns = campaigns.filter(c => (c.sent_count || 0) > 0);
    const bestCampaign = sentCampaigns.map(c => ({
      campaign: c,
      estRevenue: (c.sent_count || 0) * 45 * 0.15,
    })).sort((a, b) => b.estRevenue - a.estRevenue)[0];

    // Best employee (proxy: from notes or random — use first sub_appointment counts)
    const bestEmployee = "Roos"; // demo proxy

    return {
      revThis, revPrev, growth, expectedNext, topService, bezetting,
      noShowLoss, churnRisk, bestCampaign, svcRevenue, lossWithoutAction, biggestOpp, bestEmployee,
    };
  }, [appointments, customers, services, campaigns]);

  const recommendations = useMemo(() => {
    const rec: { title: string; reason: string; icon: typeof Lightbulb; tone: string; route: string }[] = [];
    if (metrics.bezetting < 60) {
      rec.push({ title: "Start een dinsdag-actie", reason: `Bezetting is ${metrics.bezetting}% — promotie op rustige dagen kan +20% omzet opleveren`, icon: Calendar, tone: "warning", route: "/marketing" });
    }
    if (metrics.churnRisk.length >= 3) {
      rec.push({ title: `Bel top ${Math.min(5, metrics.churnRisk.length)} verlopen klanten`, reason: "Klanten met hoge waarde dreigen weg te vallen — start win-back campagne", icon: Users, tone: "destructive", route: "/klanten?filter=risico" });
    }
    if (metrics.topService) {
      rec.push({ title: `Focus op ${metrics.topService.svc.name}`, reason: `Hoogste omzet deze week (${formatEuro(metrics.topService.revenue)}) — push deze dienst harder`, icon: TrendingUp, tone: "success", route: "/marketing" });
    }
    if (metrics.noShowLoss > 50) {
      rec.push({ title: "Activeer aanbetalingen", reason: `${formatEuro(metrics.noShowLoss)} verloren door no-shows deze week`, icon: AlertTriangle, tone: "destructive", route: "/glowpay" });
    }
    return rec.slice(0, 4);
  }, [metrics]);

  const growthPositive = metrics.growth >= 0;
  const rebookPct = customers.length > 0 ? Math.round(((customers.length - metrics.churnRisk.length) / customers.length) * 100) : 0;

  return (
    <AppLayout
      title="Eigenaar overzicht"
      subtitle="Strategische inzichten — als een digitale operations manager"
      actions={
        <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold">
          <Crown className="w-3.5 h-3.5" /> Owner mode
        </span>
      }
    >
      {/* ═══════════ EXECUTIVE HERO — 4 strategic top metrics ═══════════ */}
      <section className="grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Omzet deze week vs vorige */}
        <div
          className="lg:col-span-2 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/8 via-accent/4 to-success/8 p-6"
          style={{ boxShadow: "var(--shadow-md)" }}
        >
          <p className="text-eyebrow mb-3">Omzet deze week</p>
          <div className="flex items-end gap-3 mb-2">
            <p className="text-metric">
              <AnimatedCounter value={metrics.revThis} format={(n) => formatEuro(n)} />
            </p>
            <div className={`flex items-center gap-1 mb-1.5 px-2 py-0.5 rounded-md text-xs font-semibold ${growthPositive ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
              {growthPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {growthPositive ? "+" : ""}{metrics.growth}%
            </div>
          </div>
          <p className="text-meta">vs vorige week ({formatEuro(metrics.revPrev)})</p>
        </div>

        {/* Verwacht komende 7 dagen */}
        <button
          onClick={() => navigate("/agenda")}
          className="text-left rounded-2xl border border-border/70 bg-card p-6 hover:border-success/30 transition-all"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-3.5 h-3.5 text-success" />
            <p className="text-eyebrow">Verwacht 7 dagen</p>
          </div>
          <p className="text-metric-sm text-success">
            <AnimatedCounter value={metrics.expectedNext} format={(n) => formatEuro(n)} />
          </p>
          <p className="text-meta mt-2">Gebaseerd op geboekte afspraken</p>
        </button>

        {/* Verlies zonder actie */}
        <button
          onClick={() => navigate("/acties")}
          className="text-left rounded-2xl border border-destructive/20 bg-destructive/5 p-6 hover:border-destructive/40 transition-all"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
            <p className="text-eyebrow">Verlies zonder actie</p>
          </div>
          <p className="text-metric-sm text-destructive">
            <AnimatedCounter value={metrics.lossWithoutAction} format={(n) => formatEuro(n)} />
          </p>
          <p className="text-meta mt-2">Lege plekken + klantverloop</p>
        </button>
      </section>

      {/* Grootste groeikans — full width banner */}
      {metrics.biggestOpp && (
        <section
          className="rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/10 via-accent/6 to-primary/5 p-5 sm:p-6"
          style={{ boxShadow: "var(--shadow-md)" }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-primary" />
                <span className="text-eyebrow text-primary">Grootste groeikans nu</span>
              </div>
              <p className="text-card-title mb-1">{metrics.biggestOpp.label}</p>
              <p className="text-meta">
                Geschatte impact: <span className="font-semibold text-success">+{formatEuro(metrics.biggestOpp.value)}</span>
              </p>
            </div>
            <Button variant="gradient" size="lg" className="flex-shrink-0" onClick={() => navigate(metrics.biggestOpp.route)}>
              Pak kans <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </section>
      )}

      {/* ═══════════ STRATEGIC KPIS ═══════════ */}
      <section>
        <h2 className="text-section-title mb-4">Strategische signalen</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button onClick={() => navigate("/agenda")} className="text-left p-4 rounded-2xl bg-card border border-border/70 hover:border-primary/30 transition-all" style={{ boxShadow: "var(--shadow-xs)" }}>
            <Target className="w-4 h-4 text-primary mb-2" />
            <p className="text-metric-sm">{metrics.bezetting}%</p>
            <p className="text-meta mt-1">Bezetting team</p>
          </button>
          <button onClick={() => navigate("/klanten?filter=risico")} className="text-left p-4 rounded-2xl bg-card border border-border/70 hover:border-warning/30 transition-all" style={{ boxShadow: "var(--shadow-xs)" }}>
            <AlertTriangle className="w-4 h-4 text-warning mb-2" />
            <p className="text-metric-sm">{metrics.churnRisk.length}</p>
            <p className="text-meta mt-1">Risico op afhaken</p>
          </button>
          <button onClick={() => navigate("/rapporten?type=omzet")} className="text-left p-4 rounded-2xl bg-card border border-border/70 hover:border-destructive/30 transition-all" style={{ boxShadow: "var(--shadow-xs)" }}>
            <Euro className="w-4 h-4 text-destructive mb-2" />
            <p className="text-metric-sm">{formatEuro(metrics.noShowLoss)}</p>
            <p className="text-meta mt-1">No-show verlies week</p>
          </button>
          <button onClick={() => navigate("/herboekingen")} className="text-left p-4 rounded-2xl bg-card border border-border/70 hover:border-success/30 transition-all" style={{ boxShadow: "var(--shadow-xs)" }}>
            <Award className="w-4 h-4 text-success mb-2" />
            <p className="text-metric-sm">{rebookPct}%</p>
            <p className="text-meta mt-1">Herboekpercentage</p>
          </button>
        </div>
      </section>

      {/* ═══════════ INSIGHTS GRID ═══════════ */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-card-title">Diensten met hoogste omzet</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate("/rapporten?type=diensten")}>
              Details <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
          {metrics.svcRevenue.slice(0, 5).map((s, i) => (
            <div key={s.svc.id} className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0">
              <div className="w-7 h-7 rounded-lg bg-secondary text-xs font-semibold flex items-center justify-center">{i + 1}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{s.svc.name}</p>
                <p className="text-[11px] text-muted-foreground">{s.count} boekingen deze week</p>
              </div>
              <p className="text-sm font-bold tabular-nums">{formatEuro(s.revenue)}</p>
            </div>
          ))}
          {metrics.svcRevenue.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">Nog geen data deze week</p>
          )}
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb className="w-4 h-4 text-warning" />
            <h2 className="text-card-title">Aanbevelingen voor jou</h2>
          </div>
          {recommendations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Je salon draait goed — geen acties vereist</p>
          ) : recommendations.map((r, i) => (
            <button
              key={i}
              onClick={() => navigate(r.route)}
              className="w-full text-left flex items-start gap-3 py-3 border-b border-border/50 last:border-0 hover:bg-secondary/40 -mx-2 px-2 rounded-lg transition-colors"
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                r.tone === "destructive" ? "bg-destructive/10 text-destructive" :
                r.tone === "warning" ? "bg-warning/10 text-warning" :
                "bg-success/10 text-success"
              }`}>
                <r.icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{r.title}</p>
                <p className="text-xs text-muted-foreground leading-snug mt-0.5">{r.reason}</p>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground mt-2 flex-shrink-0" />
            </button>
          ))}
        </div>
      </section>
    </AppLayout>
  );
}
