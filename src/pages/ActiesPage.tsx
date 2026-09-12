import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useCampaigns, useDiscounts, useCustomers, useAppointments } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { supabase } from "@/integrations/supabase/client";
import { Zap, Calendar, Send, Percent, CheckCircle, Clock, ArrowRight, TrendingUp } from "lucide-react";
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


  const withoutNext = customers.filter(c => !appointments.find(a => a.customer_id === c.id && new Date(a.appointment_date) > new Date() && a.status !== 'geannuleerd'));

  const initialActions: Action[] = useMemo(() => [
    { id: "1", icon: Calendar, title: "Vul lege plekken", description: "Campagne klaarzetten voor klanten zonder afspraak", impact: `${withoutNext.length} klanten zonder vervolgafspraak`, status: "beschikbaar" },
    { id: "2", icon: Send, title: "Stuur campagne", description: "Maak een conceptcampagne voor inactieve klanten", impact: `${customers.length} klanten in database`, status: "beschikbaar" },
    { id: "3", icon: Percent, title: "Activeer korting", description: "15% korting op rustige uren", impact: "Korting wordt opgeslagen", status: "beschikbaar" },
    { id: "4", icon: Zap, title: "Auto-reboek campagne", description: `Herboekvoorstel voor ${withoutNext.length} klanten`, impact: "Auto Rebook stuurt een boekingslink", status: "beschikbaar" },
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
      // Echte Auto Rebook verzending via de canonieke engine (claim + kanaal + attributie).
      for (const c of withoutNext.slice(0, 5)) {
        await supabase.functions.invoke("auto-rebook-send", { body: { customer_id: c.id } });
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
    <AppLayout title="Omzet Autopilot" subtitle="Kansen die GlowSuite in je planning en klantenbestand ziet">
      <div className="grid gap-6">
        <div className="rounded-xl border border-border bg-card px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary"><TrendingUp className="h-4 w-4" /></div>
              <div>
                <p className="text-sm font-semibold">{available} omzetkansen klaar om te beoordelen</p>
                <p className="text-xs text-muted-foreground mt-0.5">Open een actie om te zien wat GlowSuite heeft gevonden en wat je kunt doen.</p>
              </div>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span><strong className="text-foreground">{visibleActions.filter(a => a.status === "actief").length}</strong> bezig</span>
              <span><strong className="text-success">{completed}</strong> voltooid</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
           {visibleActions.map((action) => (
             <div key={action.id} className={`rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3 transition-colors ${action.status === "voltooid" ? "opacity-65" : "hover:border-primary/25"}`}>
               <div className={`p-2.5 rounded-lg self-start ${action.status === "voltooid" ? "bg-success/15" : action.status === "actief" ? "bg-primary/15" : "bg-secondary"}`}>
                {action.status === "voltooid" ? <CheckCircle className="w-5 h-5 text-success" /> : action.status === "actief" ? <Clock className="w-5 h-5 text-primary" /> : <action.icon className="w-5 h-5 text-primary" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{action.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
                <p className="text-xs text-primary mt-1 font-medium">{action.impact}</p>
              </div>
               {action.status === "beschikbaar" && <Button size="sm" variant={action.id === "1" ? "gradient" : "outline"} onClick={() => activateAction(action.id)} className="shrink-0 w-full sm:w-auto">Bekijk en activeer <ArrowRight className="w-3 h-3 ml-1" /></Button>}
              {action.status === "actief" && <span className="text-xs text-primary animate-pulse shrink-0">Bezig...</span>}
              {action.status === "voltooid" && <span className="text-xs text-success shrink-0">Voltooid ✓</span>}
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
