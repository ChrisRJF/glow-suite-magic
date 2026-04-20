import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useCustomers, useAppointments, useServices, useCampaigns } from "@/hooks/useSupabaseData";
import { formatEuro } from "@/lib/data";
import { TrendingUp, TrendingDown, Users, Award, AlertTriangle, Target, Calendar, Euro, ArrowRight, Lightbulb } from "lucide-react";

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

    const isPaid = (a: any) => a.status !== 'geannuleerd';

    const thisWeek = appointments.filter(a => isPaid(a) && new Date(a.appointment_date) >= weekStart && new Date(a.appointment_date) <= now);
    const prevWeek = appointments.filter(a => isPaid(a) && new Date(a.appointment_date) >= prevWeekStart && new Date(a.appointment_date) < weekStart);
    const upcoming = appointments.filter(a => isPaid(a) && new Date(a.appointment_date) > now && new Date(a.appointment_date) <= next7End);

    const revThis = thisWeek.reduce((s, a) => s + (Number(a.price) || 0), 0);
    const revPrev = prevWeek.reduce((s, a) => s + (Number(a.price) || 0), 0);
    const growth = revPrev > 0 ? Math.round(((revThis - revPrev) / revPrev) * 100) : (revThis > 0 ? 100 : 0);
    const expectedNext = upcoming.reduce((s, a) => s + (Number(a.price) || 0), 0);

    // Service margin (price as proxy)
    const svcRevenue = services.map(s => {
      const aps = thisWeek.filter(a => a.service_id === s.id);
      return { svc: s, count: aps.length, revenue: aps.reduce((sum, a) => sum + (Number(a.price) || 0), 0) };
    }).sort((a, b) => b.revenue - a.revenue);
    const topService = svcRevenue[0];

    // Bezetting (proxy)
    const totalSlotsWeek = 7 * 10;
    const bezetting = Math.round((thisWeek.length / totalSlotsWeek) * 100);

    // No-show loss
    const noShows = appointments.filter(a => a.status === 'geannuleerd' && new Date(a.appointment_date) >= weekStart);
    const noShowLoss = noShows.reduce((s, a) => s + (Number(a.price) || 0), 0);

    // Churn risk customers
    const churnRisk = customers.filter(c => {
      const last = appointments
        .filter(a => a.customer_id === c.id && a.status !== 'geannuleerd')
        .sort((a, b) => new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime())[0];
      if (!last) return false;
      const days = (Date.now() - new Date(last.appointment_date).getTime()) / 86400000;
      return days > 60 && days < 180 && (Number(c.total_spent) || 0) > 100;
    });

    // Best campaign ROI
    const sentCampaigns = campaigns.filter(c => (c.sent_count || 0) > 0);
    const bestCampaign = sentCampaigns.map(c => ({
      campaign: c,
      estRevenue: (c.sent_count || 0) * 45 * 0.15,
      roi: ((c.sent_count || 0) * 45 * 0.15) / Math.max(1, (c.sent_count || 0) * 0.10),
    })).sort((a, b) => b.estRevenue - a.estRevenue)[0];

    return { revThis, revPrev, growth, expectedNext, topService, bezetting, noShowLoss, churnRisk, bestCampaign, svcRevenue };
  }, [appointments, customers, services, campaigns]);

  const recommendations = useMemo(() => {
    const rec: { title: string; reason: string; icon: typeof Lightbulb; tone: string }[] = [];
    if (metrics.bezetting < 60) {
      rec.push({ title: "Voeg een dinsdag-actie toe", reason: `Bezetting is ${metrics.bezetting}% — promotie op rustige dagen kan +20% omzet opleveren`, icon: Calendar, tone: "warning" });
    }
    if (metrics.churnRisk.length >= 3) {
      rec.push({ title: `Win ${metrics.churnRisk.length} klanten terug`, reason: "Klanten met hoge waarde dreigen weg te vallen — start win-back campagne", icon: Users, tone: "destructive" });
    }
    if (metrics.topService) {
      rec.push({ title: `Focus op ${metrics.topService.svc.name}`, reason: `Hoogste omzet deze week (${formatEuro(metrics.topService.revenue)}) — push deze dienst harder`, icon: TrendingUp, tone: "success" });
    }
    if (metrics.noShowLoss > 50) {
      rec.push({ title: "Activeer aanbetalingen", reason: `${formatEuro(metrics.noShowLoss)} verloren door no-shows deze week`, icon: AlertTriangle, tone: "destructive" });
    }
    return rec.slice(0, 4);
  }, [metrics]);

  const growthPositive = metrics.growth >= 0;

  return (
    <AppLayout title="Eigenaar overzicht" subtitle="Strategische inzichten — als een digitale operations manager">
      {/* Hero metric */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-accent/5 to-success/10 p-6">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Omzet deze week</p>
          <div className="flex items-end gap-3 mb-3">
            <p className="text-4xl font-extrabold tabular-nums">{formatEuro(metrics.revThis)}</p>
            <div className={`flex items-center gap-1 mb-1.5 px-2 py-1 rounded-lg text-xs font-semibold ${growthPositive ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'}`}>
              {growthPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {growthPositive ? '+' : ''}{metrics.growth}%
            </div>
          </div>
          <p className="text-xs text-muted-foreground">vs vorige week ({formatEuro(metrics.revPrev)})</p>
        </div>
        <div className="rounded-2xl border border-success/20 bg-card p-6">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Verwacht komende 7 dagen</p>
          <p className="text-3xl font-bold tabular-nums text-success mb-2">{formatEuro(metrics.expectedNext)}</p>
          <p className="text-xs text-muted-foreground">Gebaseerd op geboekte afspraken</p>
        </div>
      </div>

      {/* Strategic KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <button onClick={() => navigate('/agenda')} className="p-4 rounded-2xl bg-card border border-border/70 text-left hover:border-primary/30 transition-all">
          <Target className="w-4 h-4 text-primary mb-2" />
          <p className="text-2xl font-bold tabular-nums">{metrics.bezetting}%</p>
          <p className="text-[11px] text-muted-foreground">Bezettingsgraad team</p>
        </button>
        <button onClick={() => navigate('/klanten?filter=risico')} className="p-4 rounded-2xl bg-card border border-border/70 text-left hover:border-primary/30 transition-all">
          <AlertTriangle className="w-4 h-4 text-warning mb-2" />
          <p className="text-2xl font-bold tabular-nums">{metrics.churnRisk.length}</p>
          <p className="text-[11px] text-muted-foreground">Klanten risico afhaken</p>
        </button>
        <button onClick={() => navigate('/rapporten?type=omzet')} className="p-4 rounded-2xl bg-card border border-border/70 text-left hover:border-primary/30 transition-all">
          <Euro className="w-4 h-4 text-destructive mb-2" />
          <p className="text-2xl font-bold tabular-nums">{formatEuro(metrics.noShowLoss)}</p>
          <p className="text-[11px] text-muted-foreground">No-show verlies week</p>
        </button>
        <button onClick={() => navigate('/marketing')} className="p-4 rounded-2xl bg-card border border-border/70 text-left hover:border-primary/30 transition-all">
          <Award className="w-4 h-4 text-success mb-2" />
          <p className="text-2xl font-bold tabular-nums">{metrics.bestCampaign ? formatEuro(metrics.bestCampaign.estRevenue) : '—'}</p>
          <p className="text-[11px] text-muted-foreground">Beste campagne ROI</p>
        </button>
      </div>

      {/* Service margin breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Diensten met hoogste omzet</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/rapporten?type=diensten')}>
              Details <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
          {metrics.svcRevenue.slice(0, 5).map((s, i) => (
            <div key={s.svc.id} className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0">
              <div className="w-6 h-6 rounded-lg bg-secondary text-xs font-semibold flex items-center justify-center">{i + 1}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{s.svc.name}</p>
                <p className="text-[11px] text-muted-foreground">{s.count} boekingen</p>
              </div>
              <p className="text-sm font-semibold tabular-nums">{formatEuro(s.revenue)}</p>
            </div>
          ))}
          {metrics.svcRevenue.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">Nog geen data deze week</p>
          )}
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb className="w-4 h-4 text-warning" />
            <h2 className="text-base font-semibold">Aanbevelingen voor jou</h2>
          </div>
          {recommendations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Je salon draait goed — geen acties vereist</p>
          ) : recommendations.map((r, i) => (
            <div key={i} className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                r.tone === 'destructive' ? 'bg-destructive/10 text-destructive' :
                r.tone === 'warning' ? 'bg-warning/10 text-warning' :
                'bg-success/10 text-success'
              }`}>
                <r.icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{r.title}</p>
                <p className="text-xs text-muted-foreground leading-snug">{r.reason}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
