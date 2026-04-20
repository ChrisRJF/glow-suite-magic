import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomers, useAppointments, useServices, useLeads } from "@/hooks/useSupabaseData";
import { formatEuro } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Sparkles, Phone, Send, Calendar, AlertTriangle, TrendingDown, Zap, ArrowRight, Target } from "lucide-react";

interface CoachAction {
  id: string;
  icon: typeof Sparkles;
  title: string;
  reason: string;
  impact: string;
  cta: string;
  route: string;
  tone: "primary" | "warning" | "success" | "destructive";
}

export function DailyCoach() {
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const { data: services } = useServices();
  const { data: leads } = useLeads();
  const navigate = useNavigate();

  const actions = useMemo<CoachAction[]>(() => {
    const list: CoachAction[] = [];
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    const todays = appointments.filter(a => a.appointment_date?.startsWith(todayStr) && a.status !== 'geannuleerd');
    const tomorrows = appointments.filter(a => a.appointment_date?.startsWith(tomorrowStr) && a.status !== 'geannuleerd');
    const totalSlots = 10;
    const free = Math.max(0, totalSlots - todays.length);

    // 1. Lege plekken vandaag
    if (free >= 2) {
      const avg = services.length > 0 ? services.reduce((s, x) => s + Number(x.price || 0), 0) / services.length : 65;
      list.push({
        id: "fill-today",
        icon: Calendar,
        title: `Vul ${free} lege plekken vandaag`,
        reason: "Open slots in je agenda zonder klant",
        impact: `+${formatEuro(free * avg)} kans`,
        cta: "Activeer autopilot",
        route: "/#auto-revenue-engine",
        tone: "warning",
      });
    }

    // 2. Herboeking klaar
    const rebookReady = customers.filter(c => {
      const last = appointments
        .filter(a => a.customer_id === c.id && a.status !== 'geannuleerd')
        .sort((a, b) => new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime())[0];
      if (!last) return false;
      const diff = (Date.now() - new Date(last.appointment_date).getTime()) / 86400000;
      const future = appointments.find(a => a.customer_id === c.id && new Date(a.appointment_date) > now && a.status !== 'geannuleerd');
      return diff > 30 && diff < 90 && !future;
    });
    if (rebookReady.length >= 1) {
      list.push({
        id: "rebook",
        icon: Phone,
        title: `Bel ${Math.min(rebookReady.length, 5)} klanten klaar voor herboeking`,
        reason: `${rebookReady.length} klanten 30-90 dagen geleden geweest, nog geen vervolg`,
        impact: `+${formatEuro(rebookReady.length * 65)} verwacht`,
        cta: "Open herboekingen",
        route: "/herboekingen",
        tone: "primary",
      });
    }

    // 3. No-show risico morgen
    const riskTomorrow = tomorrows.filter(a => {
      const c = customers.find(x => x.id === a.customer_id);
      return c && ((c.no_show_count || 0) > 0 || (c.cancellation_count || 0) > 1);
    });
    if (riskTomorrow.length >= 1) {
      list.push({
        id: "noshow-risk",
        icon: AlertTriangle,
        title: `${riskTomorrow.length} no-show risico morgen`,
        reason: "Klanten met eerdere no-shows of annuleringen",
        impact: "Stuur extra herinnering",
        cta: "WhatsApp",
        route: "/whatsapp",
        tone: "destructive",
      });
    }

    // 4. Nieuwe leads opvolgen
    const newLeads = leads.filter(l => l.status === 'nieuw');
    if (newLeads.length >= 1) {
      list.push({
        id: "leads",
        icon: Send,
        title: `${newLeads.length} nieuwe leads wachten op opvolging`,
        reason: "Onbeantwoorde aanvragen verlies je binnen 24u",
        impact: `+${formatEuro(newLeads.length * 65)} potentieel`,
        cta: "Volg op",
        route: "/leads",
        tone: "primary",
      });
    }

    // 5. Topdienst niet geboekt deze week
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
    const weekAppts = appointments.filter(a => new Date(a.appointment_date) >= weekStart);
    const serviceCounts = services.map(s => ({
      service: s,
      count: weekAppts.filter(a => a.service_id === s.id).length,
    })).sort((a, b) => Number(b.service.price) - Number(a.service.price));
    const topMargin = serviceCounts[0];
    if (topMargin && topMargin.count === 0 && services.length > 1) {
      list.push({
        id: "top-service",
        icon: TrendingDown,
        title: `Topdienst "${topMargin.service.name}" niet geboekt deze week`,
        reason: "Hoogste marge dienst krijgt geen aandacht",
        impact: "Activeer promotie",
        cta: "Maak campagne",
        route: "/marketing",
        tone: "warning",
      });
    }

    // Fallback: alles is goed
    if (list.length === 0) {
      list.push({
        id: "all-good",
        icon: Sparkles,
        title: "Alles loopt soepel vandaag",
        reason: "Geen acute kansen — bekijk je groei-overzicht",
        impact: "Eigenaar mode",
        cta: "Open",
        route: "/eigenaar",
        tone: "success",
      });
    }

    return list.slice(0, 5);
  }, [customers, appointments, services, leads]);

  const handleClick = (route: string) => {
    if (route.startsWith("/#")) {
      const id = route.slice(2);
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate(route);
    }
  };

  const toneStyles = {
    primary: "bg-primary/5 border-primary/20 hover:border-primary/40",
    warning: "bg-warning/5 border-warning/20 hover:border-warning/40",
    success: "bg-success/5 border-success/20 hover:border-success/40",
    destructive: "bg-destructive/5 border-destructive/20 hover:border-destructive/40",
  };
  const iconTone = {
    primary: "text-primary bg-primary/10",
    warning: "text-warning bg-warning/10",
    success: "text-success bg-success/10",
    destructive: "text-destructive bg-destructive/10",
  };

  return (
    <section data-tour="daily-coach" className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Target className="w-4 h-4 text-primary-foreground" />
          </div>
          <h2 className="text-base font-semibold">Vandaag prioriteit</h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-medium">{actions.length}</span>
        </div>
        <span className="text-xs text-muted-foreground hidden sm:inline">Slimme acties op basis van je salon</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {actions.map((a) => (
          <button
            key={a.id}
            onClick={() => handleClick(a.route)}
            className={`group text-left p-4 rounded-2xl border transition-all ${toneStyles[a.tone]}`}
          >
            <div className="flex items-start gap-3 mb-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconTone[a.tone]}`}>
                <a.icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight mb-1">{a.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{a.reason}</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tabular-nums">{a.impact}</span>
              <span className="text-xs font-medium text-primary inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                {a.cta} <ArrowRight className="w-3 h-3" />
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
