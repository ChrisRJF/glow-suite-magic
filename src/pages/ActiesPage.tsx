import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Zap, Calendar, Send, Percent, CheckCircle, Clock, ArrowRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface Action {
  id: string;
  icon: typeof Zap;
  title: string;
  description: string;
  impact: string;
  status: "beschikbaar" | "actief" | "voltooid";
}

const initialActions: Action[] = [
  { id: "1", icon: Calendar, title: "Vul lege plekken", description: "3 lege plekken morgen automatisch vullen via WhatsApp campagne", impact: "±€180 extra omzet", status: "beschikbaar" },
  { id: "2", icon: Send, title: "Stuur campagne", description: "Heractiveer 12 inactieve klanten met een gepersonaliseerd bericht", impact: "±€420 potentiële omzet", status: "beschikbaar" },
  { id: "3", icon: Percent, title: "Activeer korting", description: "15% korting op maandag 14:00–17:00 om rustige uren te vullen", impact: "±€240 extra omzet", status: "beschikbaar" },
  { id: "4", icon: Zap, title: "Auto-reboek campagne", description: "Stuur herboekvoorstel naar 8 klanten zonder volgende afspraak", impact: "±€360 extra omzet", status: "beschikbaar" },
  { id: "5", icon: Send, title: "VIP follow-up", description: "Persoonlijk bericht naar top 5 klanten met exclusief aanbod", impact: "±€500 potentiële omzet", status: "beschikbaar" },
];

export default function ActiesPage() {
  const [actions, setActions] = useState(initialActions);

  const activateAction = (id: string) => {
    setActions((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "actief" as const } : a))
    );
    const action = actions.find((a) => a.id === id);
    toast.success(`"${action?.title}" is geactiveerd!`);

    setTimeout(() => {
      setActions((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: "voltooid" as const } : a))
      );
      toast.success(`"${action?.title}" is voltooid!`);
    }, 3000);
  };

  const available = actions.filter((a) => a.status === "beschikbaar").length;
  const completed = actions.filter((a) => a.status === "voltooid").length;

  return (
    <AppLayout title="Acties" subtitle="Slimme acties om je omzet te verhogen">
      <div className="grid gap-6">
        {/* Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="stat-card">
            <p className="text-xs text-muted-foreground">Beschikbare acties</p>
            <p className="text-2xl font-bold mt-1">{available}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-muted-foreground">Actief</p>
            <p className="text-2xl font-bold mt-1 text-primary">{actions.filter((a) => a.status === "actief").length}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-muted-foreground">Voltooid vandaag</p>
            <p className="text-2xl font-bold mt-1 text-emerald-400">{completed}</p>
          </div>
        </div>

        {/* Action cards */}
        <div className="space-y-3">
          {actions.map((action) => (
            <div
              key={action.id}
              className={`glass-card p-5 flex items-center gap-4 transition-all ${
                action.status === "voltooid" ? "opacity-60" : ""
              }`}
            >
              <div className={`p-3 rounded-xl ${
                action.status === "voltooid"
                  ? "bg-emerald-500/20"
                  : action.status === "actief"
                  ? "bg-primary/20 animate-pulse"
                  : "bg-secondary"
              }`}>
                {action.status === "voltooid" ? (
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                ) : action.status === "actief" ? (
                  <Clock className="w-5 h-5 text-primary" />
                ) : (
                  <action.icon className="w-5 h-5 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{action.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
                <p className="text-xs text-primary mt-1 font-medium">{action.impact}</p>
              </div>
              {action.status === "beschikbaar" && (
                <Button size="sm" onClick={() => activateAction(action.id)} className="shrink-0">
                  Activeer <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              )}
              {action.status === "actief" && (
                <span className="text-xs text-primary animate-pulse shrink-0">Bezig...</span>
              )}
              {action.status === "voltooid" && (
                <span className="text-xs text-emerald-400 shrink-0">Voltooid ✓</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
