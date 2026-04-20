import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatEuro } from "@/lib/data";
import { Send, Calendar, Sparkles, TrendingUp, AlertCircle } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

interface Props {
  customer: Tables<"customers">;
  appointments: Tables<"appointments">[];
  services: Tables<"services">[];
}

export function CustomerValueIntel({ customer, appointments, services }: Props) {
  const navigate = useNavigate();

  const intel = useMemo(() => {
    const custAppts = appointments.filter(a => a.customer_id === customer.id && a.status !== 'geannuleerd');
    const sorted = [...custAppts].sort((a, b) => new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime());
    const last = sorted[0];
    const totalSpent = Number(customer.total_spent) || custAppts.reduce((s, a) => s + (Number(a.price) || 0), 0);
    const visits = custAppts.length;
    const avg = visits > 0 ? totalSpent / visits : 0;

    // Average return cycle
    let avgCycle = 0;
    if (sorted.length >= 2) {
      const diffs: number[] = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        diffs.push((new Date(sorted[i].appointment_date).getTime() - new Date(sorted[i + 1].appointment_date).getTime()) / 86400000);
      }
      avgCycle = Math.round(diffs.reduce((s, d) => s + d, 0) / diffs.length);
    }

    const daysSinceLast = last ? Math.floor((Date.now() - new Date(last.appointment_date).getTime()) / 86400000) : 999;

    // Favorite service & employee (mocked employee since no table)
    const svcCounts: Record<string, number> = {};
    custAppts.forEach(a => { if (a.service_id) svcCounts[a.service_id] = (svcCounts[a.service_id] || 0) + 1; });
    const favSvcId = Object.entries(svcCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const favSvc = services.find(s => s.id === favSvcId);

    // Risk + recommendation
    const isVip = customer.is_vip || (totalSpent > 500 && visits >= 5);
    const isRisk = (customer.no_show_count || 0) > 0 || (customer.cancellation_count || 0) > 2;
    const churnRisk = avgCycle > 0 && daysSinceLast > avgCycle * 1.5;
    const rebookReady = avgCycle > 0 && daysSinceLast > avgCycle * 0.8 && daysSinceLast < avgCycle * 1.5;

    let recommendation = "Geen actie nodig";
    let recAction: { label: string; icon: typeof Send; route: string } | null = null;
    let recTone: "primary" | "warning" | "success" | "destructive" = "primary";

    if (isVip && rebookReady) {
      recommendation = "VIP klaar voor herboeking — persoonlijk benaderen";
      recAction = { label: "Bel direct", icon: Send, route: "/herboekingen" };
      recTone = "success";
    } else if (churnRisk) {
      recommendation = "Hoge kans op afhaken — stuur win-back aanbieding";
      recAction = { label: "Stuur aanbieding", icon: Sparkles, route: "/marketing" };
      recTone = "destructive";
    } else if (rebookReady) {
      recommendation = "Klaar voor volgende afspraak";
      recAction = { label: "Plan afspraak", icon: Calendar, route: "/agenda" };
      recTone = "primary";
    } else if (isRisk) {
      recommendation = "Stuur extra herinnering voor volgende afspraak";
      recAction = { label: "WhatsApp", icon: Send, route: "/whatsapp" };
      recTone = "warning";
    } else if (visits >= 3 && favSvc) {
      recommendation = `Upsell kans op aanvullende behandeling`;
      recAction = { label: "Stuur voorstel", icon: TrendingUp, route: "/marketing" };
      recTone = "primary";
    }

    return { totalSpent, visits, avg, avgCycle, daysSinceLast, favSvc, recommendation, recAction, recTone, isVip, churnRisk, rebookReady };
  }, [customer, appointments, services]);

  const toneStyles = {
    primary: "bg-primary/5 border-primary/20",
    warning: "bg-warning/5 border-warning/20",
    success: "bg-success/5 border-success/20",
    destructive: "bg-destructive/5 border-destructive/20",
  };

  return (
    <div data-tour="customer-value" className="space-y-4">
      {/* Value grid */}
      <div className="grid grid-cols-3 gap-2">
        <div className="p-3 rounded-xl bg-secondary/50 text-center">
          <p className="text-base font-bold tabular-nums">{formatEuro(intel.totalSpent)}</p>
          <p className="text-[10px] text-muted-foreground">Lifetime</p>
        </div>
        <div className="p-3 rounded-xl bg-secondary/50 text-center">
          <p className="text-base font-bold tabular-nums">{intel.visits}</p>
          <p className="text-[10px] text-muted-foreground">Bezoeken</p>
        </div>
        <div className="p-3 rounded-xl bg-secondary/50 text-center">
          <p className="text-base font-bold tabular-nums">{formatEuro(intel.avg)}</p>
          <p className="text-[10px] text-muted-foreground">Gemiddeld</p>
        </div>
        <div className="p-3 rounded-xl bg-secondary/50 text-center">
          <p className="text-base font-bold tabular-nums">{intel.daysSinceLast < 999 ? `${intel.daysSinceLast}d` : "—"}</p>
          <p className="text-[10px] text-muted-foreground">Laatste</p>
        </div>
        <div className="p-3 rounded-xl bg-secondary/50 text-center">
          <p className="text-base font-bold tabular-nums">{intel.avgCycle > 0 ? `${intel.avgCycle}d` : "—"}</p>
          <p className="text-[10px] text-muted-foreground">Cyclus</p>
        </div>
        <div className="p-3 rounded-xl bg-secondary/50 text-center">
          <p className="text-xs font-semibold truncate" title={intel.favSvc?.name}>{intel.favSvc?.name || "—"}</p>
          <p className="text-[10px] text-muted-foreground">Favoriet</p>
        </div>
      </div>

      {/* Recommendation */}
      <div className={`p-3 rounded-xl border ${toneStyles[intel.recTone]}`}>
        <div className="flex items-start gap-2 mb-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary" />
          <div className="flex-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Aanbevolen actie</p>
            <p className="text-xs font-medium leading-snug">{intel.recommendation}</p>
          </div>
        </div>
        {intel.recAction && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => navigate(intel.recAction!.route)}>
              <intel.recAction.icon className="w-3 h-3" /> {intel.recAction.label}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
