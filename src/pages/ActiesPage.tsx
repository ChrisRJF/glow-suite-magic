import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useCampaigns, useDiscounts, useCustomers, useAppointments } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { Zap, Calendar, Send, Percent, CheckCircle, Clock, ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

interface Action {
  id: string;
  icon: typeof Zap;
  title: string;
  description: string;
  impact: string;
  status: "beschikbaar" | "actief" | "voltooid";
}

export default function ActiesPage() {
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const { insert: insertCampaign } = useCrud("campaigns");
  const { insert: insertDiscount } = useCrud("discounts");
  const { insert: insertRebook } = useCrud("rebook_actions");

  const withoutNext = customers.filter(c => !appointments.find(a => a.customer_id === c.id && new Date(a.appointment_date) > new Date() && a.status !== 'geannuleerd'));

  const initialActions: Action[] = useMemo(() => [
    { id: "1", icon: Calendar, title: "Vul lege plekken", description: "Campagne klaarzetten voor klanten zonder afspraak", impact: `${withoutNext.length} klanten zonder vervolgafspraak`, status: "beschikbaar" },
    { id: "2", icon: Send, title: "Stuur campagne", description: "Maak een conceptcampagne voor inactieve klanten", impact: `${customers.length} klanten in database`, status: "beschikbaar" },
    { id: "3", icon: Percent, title: "Activeer korting", description: "15% korting op rustige uren", impact: "Korting wordt opgeslagen", status: "beschikbaar" },
    { id: "4", icon: Zap, title: "Auto-reboek campagne", description: `Herboekvoorstel voor ${withoutNext.length} klanten`, impact: "Rebook-acties worden aangemaakt", status: "beschikbaar" },
    { id: "5", icon: Send, title: "VIP follow-up", description: "Conceptcampagne voor top klanten", impact: "Campagne wordt klaargezet", status: "beschikbaar" },
  ], [customers.length, withoutNext.length]);

  const [actions, setActions] = useState<Action[]>([]);
  const visibleActions = actions.length ? actions : initialActions;

  const activateAction = async (id: string) => {
    const action = visibleActions.find(a => a.id === id);
    if (!action) return;
    setActions(prev => (prev.length ? prev : initialActions).map(a => a.id === id ? { ...a, status: "actief" as const } : a));
    toast.success(`"${action.title}" is geactiveerd!`);

    if (id === "2" || id === "1" || id === "5") {
      await insertCampaign({ title: action.title, type: 'whatsapp', status: 'concept', sent_count: 0, message: action.description });
    }
    if (id === "3") {
      await insertDiscount({ title: '15% korting rustige uren', type: 'percentage', value: 15, is_active: true });
    }
    if (id === "4") {
      for (const c of withoutNext.slice(0, 5)) {
        await insertRebook({ customer_id: c.id, status: 'verzonden', suggested_date: new Date(Date.now() + 7 * 86400000).toISOString() });
      }
    }

    setTimeout(() => {
      setActions(prev => (prev.length ? prev : initialActions).map(a => a.id === id ? { ...a, status: "voltooid" as const } : a));
      toast.success(`"${action.title}" is voltooid!`);
    }, 3000);
  };

  const available = visibleActions.filter(a => a.status === "beschikbaar").length;
  const completed = visibleActions.filter(a => a.status === "voltooid").length;

  return (
    <AppLayout title="Acties" subtitle="Slimme acties om je omzet te verhogen">
      <div className="grid gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="stat-card"><p className="text-xs text-muted-foreground">Beschikbare acties</p><p className="text-2xl font-bold mt-1">{available}</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground">Actief</p><p className="text-2xl font-bold mt-1 text-primary">{visibleActions.filter(a => a.status === "actief").length}</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground">Voltooid vandaag</p><p className="text-2xl font-bold mt-1 text-success">{completed}</p></div>
        </div>

        <div className="space-y-3">
           {visibleActions.map((action) => (
            <div key={action.id} className={`glass-card p-5 flex items-center gap-4 transition-all ${action.status === "voltooid" ? "opacity-60" : ""}`}>
              <div className={`p-3 rounded-xl ${action.status === "voltooid" ? "bg-success/20" : action.status === "actief" ? "bg-primary/20 animate-pulse" : "bg-secondary"}`}>
                {action.status === "voltooid" ? <CheckCircle className="w-5 h-5 text-success" /> : action.status === "actief" ? <Clock className="w-5 h-5 text-primary" /> : <action.icon className="w-5 h-5 text-primary" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{action.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
                <p className="text-xs text-primary mt-1 font-medium">{action.impact}</p>
              </div>
              {action.status === "beschikbaar" && <Button size="sm" onClick={() => activateAction(action.id)} className="shrink-0">Activeer <ArrowRight className="w-3 h-3 ml-1" /></Button>}
              {action.status === "actief" && <span className="text-xs text-primary animate-pulse shrink-0">Bezig...</span>}
              {action.status === "voltooid" && <span className="text-xs text-success shrink-0">Voltooid ✓</span>}
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
