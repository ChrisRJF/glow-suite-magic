import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useCustomers, useAppointments, useProducts, useCampaigns, useServices, useLeads } from "@/hooks/useSupabaseData";
import { formatEuro } from "@/lib/data";
import { aiSuggestions } from "@/lib/data";
import {
  TrendingUp, Users, Calendar, Euro, Sparkles, ArrowRight, Clock,
  MessageCircle, Zap, BarChart3, RefreshCw, Tag, Target,
  Send, AlertTriangle, Star, UserX, Plus, Megaphone, CalendarPlus,
  Award, UserPlus
} from "lucide-react";
import { AutoRevenueEngine } from "@/components/AutoRevenueEngine";
import { useNavigate } from "react-router-dom";
import { useMemo } from "react";

export default function DashboardPage() {
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const { data: services } = useServices();
  const { data: campaigns } = useCampaigns();
  const navigate = useNavigate();

  const todayStr = new Date().toISOString().split("T")[0];
  const todaysAppts = useMemo(() =>
    appointments.filter((a) => a.appointment_date?.startsWith(todayStr)),
    [appointments, todayStr]
  );

  const omzetVandaag = useMemo(() =>
    todaysAppts.filter(a => a.status !== 'geannuleerd').reduce((s, a) => s + (Number(a.price) || 0), 0),
    [todaysAppts]
  );

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const weekAppts = useMemo(() =>
    appointments.filter(a => {
      const d = new Date(a.appointment_date);
      return d >= weekStart && d <= weekEnd && a.status !== 'geannuleerd';
    }),
    [appointments]
  );
  const omzetWeek = weekAppts.reduce((s, a) => s + (Number(a.price) || 0), 0);
  const avgSpend = customers.length > 0
    ? customers.reduce((s, c) => s + (Number(c.total_spent) || 0), 0) / customers.length
    : 0;

  const totalSlots = 10;
  const bezetting = totalSlots > 0 ? Math.round((todaysAppts.length / totalSlots) * 100) : 0;

  const inactiveCustomers = customers.filter(c => {
    const last = appointments
      .filter(a => a.customer_id === c.id && a.status !== 'geannuleerd')
      .sort((a, b) => new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime())[0];
    if (!last) return true;
    const diff = (Date.now() - new Date(last.appointment_date).getTime()) / (1000 * 60 * 60 * 24);
    return diff > 30;
  });

  const withoutNext = customers.filter(c => {
    const future = appointments.find(a => a.customer_id === c.id && new Date(a.appointment_date) > new Date() && a.status !== 'geannuleerd');
    return !future;
  });

  const rebookPct = customers.length > 0 ? Math.round(((customers.length - withoutNext.length) / customers.length) * 100) : 0;

  const stats = [
    { label: "Omzet Vandaag", value: formatEuro(omzetVandaag), change: `${todaysAppts.length} afspr.`, icon: Euro, positive: true, helper: "Verdien meer door lege plekken te vullen", onClick: () => navigate('/omzet') },
    { label: "Gem. Besteding / Klant", value: formatEuro(avgSpend), change: `${customers.length} klanten`, icon: TrendingUp, positive: true, helper: "Meer herboekingen = meer omzet", onClick: () => navigate('/klanten') },
    { label: "Bezettingsgraad", value: `${bezetting}%`, change: `${todaysAppts.length}/${totalSlots}`, icon: BarChart3, positive: bezetting > 50, helper: "Automatiseer je marketing in 1 klik", onClick: () => navigate('/agenda') },
    { label: "Verwachte Omzet Week", value: formatEuro(omzetWeek), change: `${weekAppts.length} afspr.`, icon: Target, positive: true, helper: "Op basis van huidige agenda", onClick: () => navigate('/rapporten?type=omzet') },
  ];

  const revenueOpportunities = [
    { text: `${Math.max(0, totalSlots - todaysAppts.length)} lege plekken vandaag`, icon: "📉", urgent: todaysAppts.length < totalSlots / 2, onClick: () => navigate('/agenda') },
    { text: `${inactiveCustomers.length} inactieve klanten (30+ dagen)`, icon: "👥", urgent: inactiveCustomers.length > 5, onClick: () => navigate('/klanten?filter=risico') },
    { text: `${withoutNext.length} klanten zonder volgende afspraak`, icon: "🔄", urgent: withoutNext.length > 10, onClick: () => navigate('/herboekingen') },
  ];

  const customerSegments = [
    { label: "VIP Klanten", count: customers.filter(c => (Number(c.total_spent) || 0) > 500).length, icon: Star, color: "text-warning", onClick: () => navigate('/klanten?filter=vip') },
    { label: "Inactief (30+ dagen)", count: inactiveCustomers.length, icon: UserX, color: "text-destructive", onClick: () => navigate('/klanten?filter=risico') },
    { label: "Zonder afspraak", count: withoutNext.length, icon: AlertTriangle, color: "text-warning", onClick: () => navigate('/herboekingen') },
  ];

  // AI generated revenue from localStorage — re-read on appointment changes
  const aiRevenue = useMemo(() => {
    try {
      const log = JSON.parse(localStorage.getItem("glowsuite_action_log") || "[]");
      return log.reduce((s: number, e: any) => s + (e.revenue || 0), 0);
    } catch { return 0; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments]);

  const vrijePlekken = Math.max(0, totalSlots - todaysAppts.length);

  return (
    <AppLayout title="Overzicht" subtitle={new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' }) + " — Hier is je dag in één oogopslag."}>
      {/* KPI Balk */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '30ms' }}>
        {[
         { label: "Omzet vandaag", value: formatEuro(omzetVandaag), icon: Euro, color: "text-success", onClick: () => navigate('/rapporten?type=omzet') },
          { label: "Afspraken vandaag", value: String(todaysAppts.length), icon: Calendar, color: "text-primary", onClick: () => navigate('/agenda') },
          { label: "Vrije plekken", value: String(vrijePlekken), icon: Clock, color: vrijePlekken > 3 ? "text-destructive" : "text-warning", onClick: () => navigate('/agenda') },
          { label: "Bezettingsgraad", value: `${bezetting}%`, icon: BarChart3, color: bezetting > 70 ? "text-success" : "text-warning", onClick: () => navigate('/omzet') },
          { label: "AI omzet", value: formatEuro(aiRevenue), icon: Sparkles, color: "text-primary", onClick: () => { const el = document.getElementById('auto-revenue-engine'); el?.scrollIntoView({ behavior: 'smooth' }); } },
        ].map((kpi, i) => (
         <div key={kpi.label} onClick={() => kpi.onClick?.()} className={`flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 shadow-sm ${kpi.onClick ? 'cursor-pointer hover:border-primary/30 hover:shadow-md transition-all' : ''}`}>
            <kpi.icon className={`w-5 h-5 ${kpi.color} flex-shrink-0`} />
            <div className="min-w-0">
              <p className="text-lg font-bold tabular-nums leading-tight">{kpi.value}</p>
              <p className="text-[11px] text-muted-foreground truncate">{kpi.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Action Bar */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1 opacity-0 animate-fade-in-up" style={{ animationDelay: '60ms' }}>
        <Button variant="gradient" size="sm" className="flex-shrink-0" onClick={() => navigate('/agenda')}>
          <Plus className="w-3.5 h-3.5" /> Nieuwe afspraak
        </Button>
        <Button variant="outline" size="sm" className="flex-shrink-0 opacity-80" onClick={() => navigate('/marketing')}>
          <Megaphone className="w-3.5 h-3.5" /> Stuur campagne
        </Button>
        <Button variant="outline" size="sm" className="flex-shrink-0 opacity-80" onClick={() => navigate('/acties')}>
          <CalendarPlus className="w-3.5 h-3.5" /> Vul lege plekken
        </Button>
      </div>

      {/* AI Revenue Engine */}
      <AutoRevenueEngine />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat, i) => (
          <div key={stat.label} onClick={() => stat.onClick?.()} className={`stat-card opacity-0 animate-fade-in-up ${stat.onClick ? 'cursor-pointer hover:shadow-lg transition-shadow' : ''}`} style={{ animationDelay: `${150 + i * 80}ms` }}>
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
                <stat.icon className="w-5 h-5 text-muted-foreground" />
              </div>
              <span className="text-xs font-medium text-success">{stat.change}</span>
            </div>
            <p className="text-2xl font-bold tracking-tight tabular-nums">{stat.value}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1.5 italic">{stat.helper}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Today's Appointments */}
        <div className="lg:col-span-2 glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '450ms' }}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold">Planning Vandaag</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/agenda')}>
              Alles Bekijken <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
          <div className="space-y-3">
            {todaysAppts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Geen afspraken vandaag</p>
            ) : todaysAppts.map((apt) => {
              const svc = services.find(s => s.id === apt.service_id);
              const cust = customers.find(c => c.id === apt.customer_id);
              const time = new Date(apt.appointment_date).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={apt.id} onClick={() => navigate('/agenda')} className="flex items-center gap-4 p-3.5 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors duration-200 group cursor-pointer">
                  <div className="w-1 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: svc?.color || '#7B61FF' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{cust?.name || 'Onbekende klant'}</p>
                    <p className="text-xs text-muted-foreground">{svc?.name || 'Behandeling'}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-medium tabular-nums">{time}</p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {svc?.duration_minutes || 30} min
                    </div>
                  </div>
                  <div className={`px-2.5 py-1 rounded-lg text-[11px] font-medium ${
                    apt.status === 'voltooid' ? 'bg-success/15 text-success' :
                    apt.status === 'geannuleerd' ? 'bg-destructive/15 text-destructive' :
                    'bg-primary/15 text-primary'
                  }`}>
                    {apt.status}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* AI Suggestions */}
        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '550ms' }}>
          <div className="flex items-center gap-2 mb-5">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">AI Suggesties</h2>
          </div>
          <div className="space-y-3">
            {aiSuggestions.map((suggestion) => (
              <div key={suggestion.id} className="p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors duration-200 group">
                <div className="flex items-start gap-3">
                  <span className="text-lg flex-shrink-0">{suggestion.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium mb-1">{suggestion.title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{suggestion.description}</p>
                    <Button variant="ghost" size="sm" className="mt-2 h-7 px-2.5 text-xs text-primary" onClick={() => navigate('/acties')}>
                      {suggestion.action} <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Second Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '600ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-5 h-5 text-destructive" />
            <h2 className="text-base font-semibold">Gemiste Omzet Kansen</h2>
          </div>
          <div className="space-y-3">
            {revenueOpportunities.map((item, i) => (
              <div key={i} onClick={() => item.onClick?.()} className={`p-3 rounded-xl text-sm flex items-start gap-2.5 cursor-pointer hover:shadow-sm transition-all ${item.urgent ? 'bg-destructive/10 border border-destructive/20 hover:bg-destructive/15' : 'bg-secondary/50 hover:bg-secondary'}`}>
                <span className="flex-shrink-0">{item.icon}</span>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground/60 mt-3 italic">Verdien meer door lege plekken te vullen</p>
        </div>

        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '650ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <RefreshCw className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold">Herboekingen</h2>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="text-muted-foreground">Met volgende afspraak</span>
                <span className="font-semibold text-success">{rebookPct}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-secondary">
                <div className="h-2 rounded-full bg-success transition-all" style={{ width: `${rebookPct}%` }} />
              </div>
            </div>
            <div className="p-3 rounded-xl bg-secondary/50 text-sm">
              <p className="text-muted-foreground">Zonder nieuwe afspraak</p>
              <p className="text-xl font-bold mt-1">{withoutNext.length} <span className="text-sm font-normal text-muted-foreground">klanten</span></p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full mt-4" onClick={() => navigate('/herboekingen')}>
            <Send className="w-3.5 h-3.5" /> Stuur herboek voorstel
          </Button>
          <p className="text-[11px] text-muted-foreground/60 mt-2 italic text-center">Meer herboekingen = meer omzet</p>
        </div>

        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '700ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <Tag className="w-5 h-5 text-accent" />
            <h2 className="text-base font-semibold">Slimme Kortingen</h2>
          </div>
          <div className="p-3.5 rounded-xl bg-accent/10 border border-accent/20 mb-4">
            <p className="text-sm font-medium mb-1">💡 Suggestie</p>
            <p className="text-xs text-muted-foreground leading-relaxed">Maandag 14:00–17:00 is rustig → geef 15% korting</p>
          </div>
          <Button variant="gradient" size="sm" className="w-full" onClick={() => navigate('/acties')}>
            <Zap className="w-3.5 h-3.5" /> Activeer automatische korting
          </Button>
        </div>
      </div>

      {/* Third Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '750ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <MessageCircle className="w-5 h-5 text-success" />
            <h2 className="text-base font-semibold">WhatsApp Acties</h2>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            <Button variant="outline" size="sm" onClick={() => navigate('/whatsapp')}><Send className="w-3.5 h-3.5" /> Stuur herinnering</Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/marketing')}><Zap className="w-3.5 h-3.5" /> Last-minute deal</Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/herboekingen')}><RefreshCw className="w-3.5 h-3.5" /> Heractiveer klanten</Button>
          </div>
          <div className="p-3.5 rounded-xl bg-secondary/50 border border-border">
            <p className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">Voorbeeld bericht</p>
            <p className="text-sm leading-relaxed">"Hi Lisa 👋 je bent al 5 weken niet geweest, zin in een afspraak deze week?"</p>
          </div>
          <p className="text-[11px] text-muted-foreground/60 mt-3 italic">Automatiseer je marketing in 1 klik</p>
        </div>

        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '800ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold">Klant Segmentatie</h2>
          </div>
          <div className="space-y-3 mb-4">
            {customerSegments.map((seg, i) => (
              <div key={i} onClick={() => seg.onClick?.()} className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 cursor-pointer hover:bg-secondary transition-colors">
                <div className="flex items-center gap-2.5">
                  <seg.icon className={`w-4 h-4 ${seg.color}`} />
                  <span className="text-sm">{seg.label}</span>
                </div>
                <span className="text-sm font-semibold tabular-nums">{seg.count}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/marketing')}><Star className="w-3.5 h-3.5" /> Campagne naar VIP</Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/herboekingen')}><UserX className="w-3.5 h-3.5" /> Heractiveer inactief</Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
