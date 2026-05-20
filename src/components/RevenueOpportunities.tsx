import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, TrendingUp, RotateCcw, Star, Sparkles } from "lucide-react";
import { useAppointments, useCustomers, useServices } from "@/hooks/useSupabaseData";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEuro } from "@/lib/data";
import { cn } from "@/lib/utils";

/**
 * Calm, revenue-focused opportunity surface for the main dashboard.
 * Sits directly under "Vandaag aandacht nodig". Reuses data already loaded
 * elsewhere on the dashboard (no new heavy queries). No fake AI — only
 * lightweight client-side heuristics on real customer/appointment/service data.
 */
export function RevenueOpportunities() {
  const navigate = useNavigate();
  const { data: appointments, loading: apptsLoading } = useAppointments();
  const { data: customers, loading: custsLoading } = useCustomers();
  const { data: services, loading: svcsLoading } = useServices();

  const loading = apptsLoading || custsLoading || svcsLoading;

  const items = useMemo(() => {
    const now = Date.now();
    const DAY = 1000 * 60 * 60 * 24;
    const todayStr = new Date().toISOString().split("T")[0];

    const todaysAppts = appointments.filter(
      (a: any) => a.appointment_date?.startsWith(todayStr) && a.status !== "geannuleerd",
    );

    const ROUGH_SLOT_TARGET = 8;
    const freeSlots = Math.max(0, ROUGH_SLOT_TARGET - todaysAppts.length);

    const priced = (services as any[]).filter((s) => Number(s.price) > 0);
    const avgPrice = priced.length > 0
      ? priced.reduce((s, x) => s + Number(x.price || 0), 0) / priced.length
      : 0;
    const potentialRevenue = Math.round(freeSlots * avgPrice);

    let rebookReady = 0;
    let inactive = 0;
    let recentNoReview = 0;
    for (const c of customers as any[]) {
      const visits = (appointments as any[])
        .filter((a) => a.customer_id === c.id && a.status !== "geannuleerd")
        .sort((a, b) => new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime());
      if (visits.length === 0) continue;
      const last = visits[0];
      const daysSince = (now - new Date(last.appointment_date).getTime()) / DAY;
      const hasFuture = (appointments as any[]).some(
        (a) => a.customer_id === c.id && new Date(a.appointment_date) > new Date() && a.status !== "geannuleerd",
      );
      if (!hasFuture && daysSince >= 25 && daysSince <= 50) rebookReady++;
      if (daysSince > 60 && visits.length >= 1) inactive++;
      if (daysSince >= 1 && daysSince <= 14 && !c.last_review_at) recentNoReview++;
    }

    const list: Array<{
      key: string;
      icon: any;
      label: string;
      hint: string;
      cta: string;
      onClick: () => void;
      accent: "primary" | "success" | "muted";
    }> = [];

    if (freeSlots > 0 && potentialRevenue > 0 && todaysAppts.length < 6) {
      list.push({
        key: "rev",
        icon: TrendingUp,
        label: `Er valt vandaag nog ${formatEuro(potentialRevenue)} omzet te halen`,
        hint: "GlowSuite ziet nog ruimte in de agenda vandaag.",
        cta: "Vul lege plekken",
        onClick: () => navigate("/wachtlijst"),
        accent: "success",
      });
    }

    if (rebookReady > 0) {
      list.push({
        key: "rebook",
        icon: RotateCcw,
        label: `${rebookReady} ${rebookReady === 1 ? "klant is" : "klanten zijn"} klaar voor een herhaalafspraak`,
        hint: "GlowSuite vond klanten die waarschijnlijk opnieuw willen boeken.",
        cta: "Stuur voorstel",
        onClick: () => navigate("/herboekingen"),
        accent: "primary",
      });
    }

    if (inactive > 0) {
      list.push({
        key: "react",
        icon: Sparkles,
        label: `${inactive} ${inactive === 1 ? "vaste klant" : "vaste klanten"} al lang niet gezien`,
        hint: "Een persoonlijk berichtje brengt ze vaak terug.",
        cta: "Activeer terugkeer",
        onClick: () => navigate("/klanten?filter=risico"),
        accent: "muted",
      });
    }

    if (recentNoReview >= 2) {
      list.push({
        key: "review",
        icon: Star,
        label: `Vraag ${recentNoReview} recente klanten om een review`,
        hint: "Deze klanten reageren normaal snel op een vraag.",
        cta: "Stuur reviewvraag",
        onClick: () => navigate("/automatiseringen"),
        accent: "muted",
      });
    }

    return list.slice(0, 4);
  }, [appointments, customers, services, navigate]);

  if (loading) {
    return <Skeleton className="h-24 rounded-2xl" />;
  }

  if (items.length === 0) return null;

  const accentClass = (a: string) => {
    switch (a) {
      case "success":
        return "text-success bg-success/10";
      case "primary":
        return "text-primary bg-primary/10";
      default:
        return "text-muted-foreground bg-secondary";
    }
  };

  return (
    <section aria-label="Omzetkansen vandaag">
      <div className="mb-2.5">
        <h2 className="text-section-title">Omzetkansen vandaag</h2>
        <p className="text-meta mt-0.5">Waar GlowSuite extra ruimte ziet</p>
      </div>
      <div
        className="rounded-2xl border border-border/60 bg-card/70 divide-y divide-border/40 overflow-hidden"
        style={{ boxShadow: "var(--shadow-sm)" }}
      >
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <button
              key={it.key}
              onClick={it.onClick}
              className="w-full flex items-center gap-3 text-left px-4 py-2.5 hover:bg-secondary/40 active:scale-[0.997] transition-all duration-200 ease-out group"
            >
              <div className={cn("rounded-xl flex items-center justify-center flex-shrink-0 w-8 h-8", accentClass(it.accent))}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold leading-tight text-foreground truncate text-[14px]">{it.label}</p>
                <p className="text-[11px] text-muted-foreground/80 mt-0.5 truncate">{it.hint}</p>
              </div>
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0">
                {it.cta}
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </span>
              <ArrowRight className="sm:hidden w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
