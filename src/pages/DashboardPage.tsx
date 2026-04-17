import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useCustomers, useAppointments, useServices, useCampaigns, useLeads } from "@/hooks/useSupabaseData";
import { formatEuro } from "@/lib/data";
import {
  TrendingUp, Users, Calendar, Euro, Sparkles, ArrowRight, Clock,
  Zap, BarChart3, RefreshCw, Target,
  Send, Star, UserX, Award, UserPlus, ChevronDown
} from "lucide-react";
import { AutoRevenueEngine } from "@/components/AutoRevenueEngine";
import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

export default function DashboardPage() {
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const { data: services } = useServices();
  const { data: campaigns } = useCampaigns();
  const { data: leads } = useLeads();
  const navigate = useNavigate();
  const [showDetails, setShowDetails] = useState(false);

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

  const totalSlots = 10;
  const bezetting = totalSlots > 0 ? Math.round((todaysAppts.length / totalSlots) * 100) : 0;
  const vrijePlekken = Math.max(0, totalSlots - todaysAppts.length);

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

  const aiRevenue = useMemo(() => {
    try {
      const log = JSON.parse(localStorage.getItem("glowsuite_action_log") || "[]");
      return log.reduce((s: number, e: any) => s + (e.revenue || 0), 0);
    } catch { return 0; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments]);

  const campaignRevenue = useMemo(() => {
    const successful = campaigns.filter(c => c.status === 'verzonden' || c.status === 'geboekt');
    return successful.reduce((s, c) => s + ((c.sent_count || 0) * 45), 0);
  }, [campaigns]);

  const messagesSent = useMemo(() =>
    campaigns.filter(c => (c.type === 'whatsapp' || c.type === 'sms') && c.status && c.status !== 'concept').length,
    [campaigns]
  );

  const recoveredCustomers = useMemo(() => {
    return inactiveCustomers.filter(c => {
      const futureAppt = appointments.find(a => a.customer_id === c.id && new Date(a.appointment_date) > new Date() && a.status !== 'geannuleerd');
      return !!futureAppt;
    }).length;
  }, [inactiveCustomers, appointments]);

  const autoFilledAppts = useMemo(() => {
    return appointments.filter(a => a.notes?.includes('Auto-gevuld')).length;
  }, [appointments]);

  const monthlyGrowthRevenue = aiRevenue + campaignRevenue;
  const missedRevenue = vrijePlekken * 65;

  const vipCustomers = customers.filter(c => (Number(c.total_spent) || 0) > 500);
  const newLeads = leads.filter(l => l.status === 'nieuw').length;
  const leadsConverted = leads.filter(l => l.status === 'klant_geworden' || l.status === 'geboekt').length;
  const leadsConversionPct = leads.length > 0 ? Math.round((leadsConverted / leads.length) * 100) : 0;
  const leadsRevenue = leadsConverted * 65;

  // Employees context for free slots
  const employeeNames = ["Bas", "Roos", "Kim"];
  const freeSlotContext = vrijePlekken > 0
    ? `Vandaag ${vrijePlekken} plekken vrij (${employeeNames.slice(0, Math.min(vrijePlekken, 2)).join(", ")})`
    : "Agenda vandaag is vol";

  return (
    <AppLayout title="Overzicht" subtitle={new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}>

      {/* ═══════════ BLOCK 1: KPI's ═══════════ */}

      {/* Hero — AI gegenereerde omzet (dominant) */}
      <div className="mb-4">
        <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-accent/5 to-success/10 p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">AI gegenereerde omzet</p>
              <p className="text-4xl sm:text-5xl font-extrabold tracking-tight tabular-nums text-primary">
                {formatEuro(aiRevenue)}
              </p>
              {monthlyGrowthRevenue > 0 && (
                <p className="text-sm text-success font-medium mt-2 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  {formatEuro(monthlyGrowthRevenue)} totale extra omzet deze maand
                </p>
              )}
              {aiRevenue === 0 && missedRevenue > 0 && (
                <p className="text-sm text-warning font-medium mt-2">
                  GlowSuite kan vandaag {formatEuro(missedRevenue)} extra omzet genereren
                </p>
              )}
            </div>
            <div className="flex-shrink-0">
              <Button
                variant="gradient"
                size="lg"
                className="font-semibold shadow-lg text-base px-6"
                onClick={() => {
                  const el = document.getElementById('auto-revenue-engine');
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                <Zap className="w-5 h-5" /> Vul mijn agenda automatisch
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Secondary KPI's — compact, smaller */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        {[
          { label: "Omzet vandaag", value: formatEuro(omzetVandaag), icon: Euro, color: "text-success", onClick: () => navigate('/rapporten?type=omzet') },
          { label: "Afspraken", value: String(todaysAppts.length), icon: Calendar, color: "text-primary", onClick: () => navigate('/agenda') },
          { label: "Vrije plekken", value: String(vrijePlekken), icon: Clock, color: vrijePlekken > 3 ? "text-destructive" : "text-warning", onClick: () => navigate('/agenda') },
          { label: "Bezetting", value: `${bezetting}%`, icon: BarChart3, color: bezetting > 70 ? "text-success" : "text-warning", onClick: () => navigate('/omzet') },
        ].map((kpi) => (
          <div
            key={kpi.label}
            onClick={kpi.onClick}
            className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 shadow-sm cursor-pointer hover:border-primary/30 hover:shadow-md transition-all"
          >
            <kpi.icon className={`w-4 h-4 ${kpi.color} flex-shrink-0`} />
            <div className="min-w-0">
              <p className="text-base font-bold tabular-nums leading-tight">{kpi.value}</p>
              <p className="text-[10px] text-muted-foreground truncate">{kpi.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ═══════════ BLOCK 2: AI / Acties ═══════════ */}

      {/* Context line */}
      {vrijePlekken > 0 && (
        <p className="text-sm text-muted-foreground mb-3 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-warning" />
          {freeSlotContext}
        </p>
      )}

      {/* Auto Revenue Engine */}
      <div className="mb-10">
        <AutoRevenueEngine />
      </div>

      {/* ROI Summary — simplified */}
      <div className="rounded-2xl border border-success/20 bg-card p-5 mb-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-success" />
            <h2 className="text-base font-semibold">GlowSuite ROI</h2>
          </div>
          {monthlyGrowthRevenue > 0 && (
            <span className="text-xs bg-success/15 text-success px-2.5 py-1 rounded-lg font-medium">
              +{formatEuro(monthlyGrowthRevenue)} deze maand
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-success/10 cursor-pointer hover:bg-success/15 transition-colors" onClick={() => { document.getElementById('auto-revenue-engine')?.scrollIntoView({ behavior: 'smooth' }); }}>
            <p className="text-lg font-bold text-success tabular-nums">{formatEuro(aiRevenue)}</p>
            <p className="text-[10px] text-muted-foreground">AI omzet</p>
          </div>
          <div className="p-3 rounded-xl bg-primary/10 cursor-pointer hover:bg-primary/15 transition-colors" onClick={() => navigate('/whatsapp')}>
            <p className="text-lg font-bold text-primary tabular-nums">{formatEuro(campaignRevenue)}</p>
            <p className="text-[10px] text-muted-foreground">Campagnes · {messagesSent} berichten</p>
          </div>
          <div className="p-3 rounded-xl bg-warning/10 cursor-pointer hover:bg-warning/15 transition-colors" onClick={() => navigate('/klanten?filter=risico')}>
            <p className="text-lg font-bold text-warning tabular-nums">{recoveredCustomers}</p>
            <p className="text-[10px] text-muted-foreground">Teruggewonnen</p>
          </div>
          <div className="p-3 rounded-xl bg-accent/10 cursor-pointer hover:bg-accent/15 transition-colors" onClick={() => navigate('/agenda')}>
            <p className="text-lg font-bold text-accent tabular-nums">{autoFilledAppts}</p>
            <p className="text-[10px] text-muted-foreground">Auto-gevuld</p>
          </div>
        </div>
      </div>

      {/* ═══════════ BLOCK 3: Details / Inzichten ═══════════ */}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
        {/* Planning vandaag — main detail */}
        <div className="lg:col-span-2 glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Planning Vandaag</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/agenda')}>
              Bekijken <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
          <div className="space-y-2.5">
            {todaysAppts.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground mb-1">Geen afspraken vandaag</p>
                <p className="text-xs text-warning font-medium">Activeer de autopilot om plekken te vullen</p>
              </div>
            ) : todaysAppts.slice(0, 5).map((apt) => {
              const svc = services.find(s => s.id === apt.service_id);
              const cust = customers.find(c => c.id === apt.customer_id);
              const time = new Date(apt.appointment_date).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={apt.id} onClick={() => navigate('/agenda')} className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors cursor-pointer">
                  <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: svc?.color || '#7B61FF' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{cust?.name || 'Klant'} — {svc?.name || 'Behandeling'}</p>
                  </div>
                  <p className="text-sm font-medium tabular-nums text-muted-foreground">{time}</p>
                  <div className={`px-2 py-0.5 rounded-md text-[10px] font-medium ${
                    apt.status === 'voltooid' ? 'bg-success/15 text-success' :
                    apt.status === 'geannuleerd' ? 'bg-destructive/15 text-destructive' :
                    'bg-primary/15 text-primary'
                  }`}>
                    {apt.status}
                  </div>
                </div>
              );
            })}
            {todaysAppts.length > 5 && (
              <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => navigate('/agenda')}>
                +{todaysAppts.length - 5} meer
              </Button>
            )}
          </div>
        </div>

        {/* Single insight card — simplified */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-5 h-5 text-destructive" />
            <h2 className="text-base font-semibold">Belangrijkste kans</h2>
          </div>

          {/* Show the most urgent opportunity */}
          {vrijePlekken > 0 ? (
            <div className="p-4 rounded-xl bg-destructive/5 border border-destructive/15 mb-4">
              <p className="text-sm font-medium mb-1">📉 {vrijePlekken} lege plekken vandaag</p>
              <p className="text-xs text-muted-foreground">{formatEuro(missedRevenue)} omzet gaat verloren zonder actie</p>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-success/5 border border-success/15 mb-4">
              <p className="text-sm font-medium mb-1">✅ Agenda is vol</p>
              <p className="text-xs text-muted-foreground">Alle plekken zijn gevuld vandaag</p>
            </div>
          )}

          {/* Herboekingen progress */}
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="text-muted-foreground text-xs">Herboekingspercentage</span>
              <span className="font-semibold text-xs">{rebookPct}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-secondary">
              <div className="h-1.5 rounded-full bg-success transition-all" style={{ width: `${rebookPct}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">{withoutNext.length} klanten zonder volgende afspraak</p>
          </div>

          <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/herboekingen')}>
            <Send className="w-3.5 h-3.5" /> Herboek voorstel sturen
          </Button>
        </div>
      </div>

      {/* Compact details row — toggleable */}
      <div className="mb-6">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
          Meer inzichten
        </button>

        {showDetails && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in-up">
            {/* Klantwaarde */}
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Klantwaarde</h3>
              </div>
              <div className="space-y-2">
                <div onClick={() => navigate('/klanten?filter=vip')} className="flex items-center justify-between text-sm cursor-pointer hover:text-primary transition-colors">
                  <span className="flex items-center gap-1.5"><Star className="w-3 h-3 text-warning" /> VIP</span>
                  <span className="font-semibold tabular-nums">{vipCustomers.length}</span>
                </div>
                <div onClick={() => navigate('/klanten?filter=risico')} className="flex items-center justify-between text-sm cursor-pointer hover:text-primary transition-colors">
                  <span className="flex items-center gap-1.5"><UserX className="w-3 h-3 text-destructive" /> Inactief</span>
                  <span className="font-semibold tabular-nums">{inactiveCustomers.length}</span>
                </div>
              </div>
            </div>

            {/* Leads */}
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <UserPlus className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Leads</h3>
              </div>
              <div className="space-y-2">
                <div onClick={() => navigate('/leads')} className="flex items-center justify-between text-sm cursor-pointer hover:text-primary transition-colors">
                  <span>Nieuw</span>
                  <span className="font-semibold tabular-nums">{newLeads}</span>
                </div>
                <div onClick={() => navigate('/leads')} className="flex items-center justify-between text-sm cursor-pointer hover:text-primary transition-colors">
                  <span>Geconverteerd</span>
                  <span className="font-semibold tabular-nums text-success">{leadsConverted}</span>
                </div>
                <div onClick={() => navigate('/leads')} className="flex items-center justify-between text-sm cursor-pointer hover:text-primary transition-colors">
                  <span>Conversie</span>
                  <span className="font-semibold tabular-nums">{leadsConversionPct}%</span>
                </div>
                <div onClick={() => navigate('/leads')} className="flex items-center justify-between text-sm cursor-pointer hover:text-primary transition-colors">
                  <span>Omzet</span>
                  <span className="font-semibold tabular-nums text-success">{formatEuro(leadsRevenue)}</span>
                </div>
              </div>
            </div>

            {/* Snelle acties */}
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <RefreshCw className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Acties</h3>
              </div>
              <div className="space-y-2">
                <Button variant="ghost" size="sm" className="w-full justify-start h-7 text-xs" onClick={() => navigate('/whatsapp')}>
                  <Send className="w-3 h-3" /> WhatsApp herinnering
                </Button>
                <Button variant="ghost" size="sm" className="w-full justify-start h-7 text-xs" onClick={() => navigate('/marketing')}>
                  <TrendingUp className="w-3 h-3" /> Campagne sturen
                </Button>
              </div>
            </div>

            {/* Loyaliteit */}
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Award className="w-4 h-4 text-warning" />
                <h3 className="text-sm font-semibold">Loyaliteit</h3>
              </div>
              <div className="space-y-2">
                <div onClick={() => navigate('/abonnementen')} className="flex items-center justify-between text-sm cursor-pointer hover:text-primary transition-colors">
                  <span className="flex items-center gap-1.5"><Star className="w-3 h-3 text-warning" /> VIP</span>
                  <span className="font-semibold tabular-nums">{vipCustomers.length}</span>
                </div>
                <Button variant="ghost" size="sm" className="w-full justify-start h-7 text-xs" onClick={() => navigate('/abonnementen')}>
                  <Award className="w-3 h-3" /> Bekijk programma
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
