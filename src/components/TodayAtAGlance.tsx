import { useEffect, useMemo, useState } from "react";
import { CalendarX, TrendingUp, AlertTriangle, Clock, Hourglass, ShieldAlert, ArrowRight } from "lucide-react";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useAutoRevenueRunner } from "@/hooks/useAutoRevenueRunner";
import { useCustomers, useAppointments } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { formatEuro } from "@/lib/data";
import { calculateNoShowRisk } from "@/lib/noShowRisk";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

/**
 * Read-only insight grid. Reuses the existing autopilot runner for empty
 * slots and projected extra revenue, and pulls open pending_payment offers
 * from auto_revenue_offers. No new business logic, no side effects.
 */
export function TodayAtAGlance({ mobileNoShowRiskTomorrow, mobileNoShowRiskTomorrowId }: { mobileNoShowRiskTomorrow?: number; mobileNoShowRiskTomorrowId?: string }) {
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
      if (calculateNoShowRisk(c).isElevated) noShowRisk++;
      if (daysSince > 60 && visits.length >= 1) churnRisk++;
      if (daysSince > 25 && daysSince < 50 && visits.length >= 1) followUp++;
    }
    return { churnRisk, noShowRisk, followUp };
  }, [customers, appointments]);

  type Tone = "success" | "warning" | "amber" | "violet" | "rose" | "muted";

  const toneClass: Record<Tone, string> = {
    success: "from-emerald-500/10 to-emerald-500/0 text-emerald-600 dark:text-emerald-400",
    warning: "from-amber-500/12 to-amber-500/0 text-amber-600 dark:text-amber-400",
    amber: "from-amber-500/10 to-amber-500/0 text-amber-600 dark:text-amber-400",
    violet: "from-violet-500/10 to-violet-500/0 text-violet-600 dark:text-violet-400",
    rose: "from-rose-500/12 to-rose-500/0 text-rose-600 dark:text-rose-400",
    muted: "from-primary/8 to-primary/0 text-primary",
  };

  const cards: Array<{
    label: string;
    value: number;
    isCurrency?: boolean;
    icon: any;
    tone: Tone;
    cta: string;
    to: string;
    active: boolean;
  }> = [
    {
      label: emptySlots > 0
        ? `${emptySlots} lege ${emptySlots === 1 ? "plek kan" : "plekken kunnen"} vandaag gevuld worden`
        : "Agenda lijkt goed gevuld vandaag.",
      value: emptySlots,
      icon: CalendarX,
      tone: emptySlots > 0 ? "muted" : "success",
      cta: emptySlots > 0 ? "Bekijk lege plekken" : "Bekijk agenda",
      to: "/agenda",
      active: emptySlots > 0,
    },
    {
      label: projectedExtraRevenue > 0
        ? "Potentiële extra omzet vandaag"
        : "Vandaag draait stabiel.",
      value: projectedExtraRevenue,
      isCurrency: true,
      icon: TrendingUp,
      tone: "success",
      cta: "Start autopilot",
      to: "/auto-revenue",
      active: projectedExtraRevenue > 0,
    },
    {
      label: intelligence.churnRisk > 0
        ? `${intelligence.churnRisk} vaste ${intelligence.churnRisk === 1 ? "klant dreigt" : "klanten dreigen"} af te haken`
        : "Geen klanten in risico.",
      value: intelligence.churnRisk,
      icon: AlertTriangle,
      tone: intelligence.churnRisk > 0 ? "amber" : "success",
      cta: "Stuur bericht",
      to: "/klanten?filter=risico",
      active: intelligence.churnRisk > 0,
    },
    {
      label: intelligence.followUp > 0
        ? `${intelligence.followUp} klanten klaar voor herhaalafspraak`
        : "Geen directe opvolging nodig.",
      value: intelligence.followUp,
      icon: Clock,
      tone: intelligence.followUp > 0 ? "muted" : "success",
      cta: "Stuur voorstel",
      to: "/herboekingen",
      active: intelligence.followUp > 0,
    },
    {
      label: pendingPayments > 0
        ? `${pendingPayments} ${pendingPayments === 1 ? "afspraak wacht" : "afspraken wachten"} op betaling`
        : "Alle betalingen lopen door.",
      value: pendingPayments,
      icon: Hourglass,
      tone: pendingPayments > 0 ? "amber" : "success",
      cta: "Bekijk betalingen",
      to: "/glowpay?filter=pending",
      active: pendingPayments > 0,
    },
    {
      label: intelligence.noShowRisk > 0
        ? `${intelligence.noShowRisk} ${intelligence.noShowRisk === 1 ? "klant heeft" : "klanten hebben"} verhoogd no-show risico`
        : "Alles loopt volgens planning.",
      value: intelligence.noShowRisk,
      icon: ShieldAlert,
      tone: intelligence.noShowRisk > 0 ? "rose" : "success",
      cta: "Controleer afspraak",
      to: "/agenda",
      active: intelligence.noShowRisk > 0,
    },
  ];

  return (
    <section>
      <div className="flex items-end justify-between mb-2.5 gap-3">
        <div>
          <h2 className="text-section-title">Vandaag in één oogopslag</h2>
          <p className="text-meta mt-0.5 flex items-center gap-1.5">
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500/60 opacity-75 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Live bijgewerkt
          </p>
        </div>
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
            demoMode
              ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {demoMode ? "Demo omgeving" : "Live data"}
        </span>
      </div>
      {/* Mobile: only cards that need attention; calm states are summarised in one line. */}
      {cards.every((c) => !c.active) && !mobileNoShowRiskTomorrow && (
        <p className="sm:hidden rounded-xl border border-border/60 bg-card px-3 py-2.5 text-[12px] text-muted-foreground">Alles loopt volgens planning.</p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5 sm:gap-2">
        {cards.map((c, i) => (
          c.icon === ShieldAlert && mobileNoShowRiskTomorrow !== undefined ? (
            <div key={c.label} className="contents">
              {((mobileNoShowRiskTomorrow ?? 0) > 0 || intelligence.noShowRisk > 0) && (
                <div className="sm:hidden col-span-2 rounded-xl border border-border/60 bg-card p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldAlert className={`h-4 w-4 shrink-0 ${(mobileNoShowRiskTomorrow ?? 0) > 0 ? "text-warning" : "text-muted-foreground"}`} />
                    No-showrisico
                  </div>
                  <p className="mt-1 text-sm">
                    {(mobileNoShowRiskTomorrow ?? 0) > 0 ? (
                      <><span className="font-semibold tabular-nums">{mobileNoShowRiskTomorrow}</span> {(mobileNoShowRiskTomorrow ?? 0) === 1 ? "afspraak" : "afspraken"} morgen met verhoogd risico</>
                    ) : (
                      <span className="text-muted-foreground">Geen afspraken morgen met verhoogd risico</span>
                    )}
                  </p>
                  {(mobileNoShowRiskTomorrow ?? 0) > 0 && (
                    <Button
                      size="sm"
                      className="mt-2 h-8"
                      onClick={() => navigate(mobileNoShowRiskTomorrowId ? `/agenda?afspraak=${encodeURIComponent(mobileNoShowRiskTomorrowId)}` : "/agenda")}
                    >
                      Bekijk afspraak <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <details className="mt-2 group">
                    <summary className="cursor-pointer list-none text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">Meer details</summary>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {intelligence.noShowRisk} {intelligence.noShowRisk === 1 ? "klant heeft" : "klanten hebben"} verhoogd risico in het hele klantenbestand, ongeacht de afspraakdatum.
                    </p>
                    <div className="mt-1 flex flex-wrap gap-x-4">
                      <Button variant="ghost" size="sm" className="h-8 px-0 text-xs" onClick={() => navigate("/whatsapp")}>
                        Bekijk herinneringen <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 px-0 text-xs" onClick={() => navigate(c.to)}>
                        {c.cta} <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </details>
                </div>
              )}
              {renderCard(c, i, true)}
            </div>
          ) : renderCard(c, i)
        ))}
      </div>
    </section>
  );

  function renderCard(c: typeof cards[number], i: number, desktopOnly = false) {
    return <button
            key={c.label}
            data-active={c.active}
            onClick={() => navigate(c.to)}
            style={{ animationDelay: `${i * 30}ms` }}
            className={`${desktopOnly || !c.active ? "hidden sm:block" : ""} text-left relative rounded-xl border border-border/60 p-2.5 bg-gradient-to-br ${toneClass[c.tone]} transition-all duration-200 ease-out hover:border-primary/30 hover:-translate-y-0.5 active:scale-[0.997] animate-fade-in group`}
          >
            <div className="flex items-start justify-between gap-2">
              <c.icon className="w-3.5 h-3.5 opacity-70" />
              <p className="text-lg font-semibold tabular-nums text-foreground leading-none">
                {c.isCurrency ? (
                  <AnimatedCounter value={Number(c.value) || 0} format={(n) => formatEuro(n)} />
                ) : (
                  <AnimatedCounter value={Number(c.value) || 0} />
                )}
              </p>
            </div>
            <p className="text-[11px] mt-1.5 leading-snug text-foreground/90">{c.label}</p>
            {c.active && (
              <p className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-medium text-foreground/70 group-hover:text-primary transition-colors">
                {c.cta}
                <ArrowRight className="w-2.5 h-2.5 group-hover:translate-x-0.5 transition-transform" />
              </p>
            )}
          </button>;
  }
}
