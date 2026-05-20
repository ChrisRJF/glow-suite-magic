import { useEffect, useMemo, useState } from "react";
import { CalendarX, TrendingUp, AlertTriangle, Clock, Hourglass, ShieldAlert } from "lucide-react";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useAutoRevenueRunner } from "@/hooks/useAutoRevenueRunner";
import { useCustomers, useAppointments } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { formatEuro } from "@/lib/data";
import { useNavigate } from "react-router-dom";

/**
 * Read-only insight grid. Reuses the existing autopilot runner for empty
 * slots and projected extra revenue, and pulls open pending_payment offers
 * from auto_revenue_offers. No new business logic, no side effects.
 */
export function TodayAtAGlance() {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const navigate = useNavigate();

  const { emptySlots, projectedExtraRevenue } = useAutoRevenueRunner({ source: "auto-revenue" });

  const [pendingPayments, setPendingPayments] = useState(0);

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
        const { data } = await supabase
          .from("auto_revenue_offers")
          .select("id, status")
          .eq("user_id", user.id)
          .eq("is_demo", demoMode)
          .eq("status", "pending_payment")
          .gte("created_at", sinceIso);
        if (!cancelled) setPendingPayments((data as any[])?.length || 0);
      } catch {
        if (!cancelled) setPendingPayments(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, demoMode, sinceIso]);

  const intelligence = useMemo(() => {
    const now = Date.now();
    const DAY = 1000 * 60 * 60 * 24;
    let churnRisk = 0;
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
      const noShows = Number(c.no_show_count || 0);
      if (noShows >= 2) noShowRisk++;
      if (daysSince > 60 && visits.length >= 1) churnRisk++;
      if (daysSince > 25 && daysSince < 50 && visits.length >= 1) followUp++;
    }
    return { churnRisk, noShowRisk, followUp };
  }, [customers, appointments]);

  const cards = [
    {
      label: emptySlots > 0
        ? `${emptySlots} lege ${emptySlots === 1 ? "plek kan" : "plekken kunnen"} vandaag gevuld worden`
        : "Agenda is volgeboekt vandaag",
      value: emptySlots,
      icon: CalendarX,
      accent: "from-primary/15 to-primary/0 text-primary",
      to: "/wachtlijst",
    },
    {
      label: "Potentiële extra omzet vandaag",
      value: projectedExtraRevenue,
      isCurrency: true,
      icon: TrendingUp,
      accent: "from-emerald-500/15 to-emerald-500/0 text-emerald-600 dark:text-emerald-400",
      to: "/auto-revenue",
    },
    {
      label: intelligence.churnRisk > 0
        ? `${intelligence.churnRisk} vaste ${intelligence.churnRisk === 1 ? "klant dreigt" : "klanten dreigen"} af te haken`
        : "Geen klanten in churn risico",
      value: intelligence.churnRisk,
      icon: AlertTriangle,
      accent: "from-amber-500/15 to-amber-500/0 text-amber-600 dark:text-amber-400",
      to: "/klanten?filter=risico",
    },
    {
      label: intelligence.followUp > 0
        ? `${intelligence.followUp} klanten wachten op opvolging`
        : "Geen openstaande follow ups",
      value: intelligence.followUp,
      icon: Clock,
      accent: "from-primary/15 to-primary/0 text-primary",
      to: "/herboekingen",
    },
    {
      label: pendingPayments > 0
        ? `${pendingPayments} ${pendingPayments === 1 ? "afspraak wacht" : "afspraken wachten"} op betaling`
        : "Geen openstaande betalingen",
      value: pendingPayments,
      icon: Hourglass,
      accent: "from-violet-500/15 to-violet-500/0 text-violet-600 dark:text-violet-400",
      to: "/betalingen",
    },
    {
      label: intelligence.noShowRisk > 0
        ? `${intelligence.noShowRisk} ${intelligence.noShowRisk === 1 ? "afspraak heeft" : "afspraken hebben"} no show risico`
        : "Geen no show risico",
      value: intelligence.noShowRisk,
      icon: ShieldAlert,
      accent: "from-rose-500/15 to-rose-500/0 text-rose-600 dark:text-rose-400",
      to: "/whatsapp",
    },
  ];

  return (
    <section>
      <div className="flex items-end justify-between mb-3">
        <div>
          <h2 className="text-section-title">Vandaag in één oogopslag</h2>
          <p className="text-meta mt-1">Operationele signalen uit je salon</p>
        </div>
        <span className="text-[11px] text-muted-foreground">{demoMode ? "Demo data" : "Live data"}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {cards.map((c, i) => (
          <button
            key={c.label}
            onClick={() => navigate(c.to)}
            style={{ animationDelay: `${i * 30}ms` }}
            className={`text-left relative rounded-2xl border border-border/70 p-3 bg-gradient-to-br ${c.accent} transition-all hover:border-primary/30 hover:-translate-y-0.5 active:scale-[0.997] animate-fade-in`}
          >
            <div className="flex items-start justify-between gap-2">
              <c.icon className="w-4 h-4 opacity-70" />
              <p className="text-xl font-semibold tabular-nums text-foreground leading-none">
                {c.isCurrency ? (
                  <AnimatedCounter value={Number(c.value) || 0} format={(n) => formatEuro(n)} />
                ) : (
                  <AnimatedCounter value={Number(c.value) || 0} />
                )}
              </p>
            </div>
            <p className="text-[11px] mt-1.5 leading-snug text-foreground/90">{c.label}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
