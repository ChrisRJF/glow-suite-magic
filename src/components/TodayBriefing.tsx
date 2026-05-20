import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CreditCard, CalendarClock, Crown, Sparkles } from "lucide-react";
import { useAppointments, useCustomerMemberships } from "@/hooks/useSupabaseData";
import { usePayments } from "@/hooks/usePayments";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * "Today" command-center card.
 * Calm, factual signals based on real data only — no AI guesses.
 *  - open payments today
 *  - empty slots today (rough heuristic from today's appointments)
 *  - memberships expiring within 14 days
 *  - quiet-day nudge (only when today is genuinely quiet)
 */
export function TodayBriefing() {
  const navigate = useNavigate();
  const { data: payments, loading: paymentsLoading } = usePayments();
  const { data: appointments, loading: apptsLoading } = useAppointments();
  const { data: memberships, loading: memLoading } = useCustomerMemberships();

  const loading = paymentsLoading || apptsLoading || memLoading;

  const items = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const dayName = today.toLocaleDateString("nl-NL", { weekday: "long" });

    const todaysAppts = appointments.filter(
      (a: any) => a.appointment_date?.startsWith(todayStr) && a.status !== "geannuleerd",
    );

    const openPaymentsToday = payments.filter((p: any) => {
      if (p.status !== "pending") return false;
      const created = p.created_at?.startsWith(todayStr);
      const due = p.appointment_id
        ? appointments.find((a: any) => a.id === p.appointment_id)?.appointment_date?.startsWith(todayStr)
        : false;
      return created || due;
    });

    // Heuristic: assume an 8-slot day; show free slots only if there's real room
    const ROUGH_SLOT_TARGET = 8;
    const freeSlots = Math.max(0, ROUGH_SLOT_TARGET - todaysAppts.length);

    const in14 = new Date();
    in14.setDate(in14.getDate() + 14);
    const expiringMemberships = (memberships || []).filter((m: any) => {
      if (m.status !== "active") return false;
      const end = m.current_period_end || m.end_date;
      if (!end) return false;
      const d = new Date(end);
      return d >= today && d <= in14;
    });

    const isQuiet = todaysAppts.length > 0 && todaysAppts.length <= 3;

    const list: Array<{
      key: string;
      icon: any;
      label: string;
      why: string;
      onClick: () => void;
      tone: "primary" | "warning" | "success" | "muted";
    }> = [];

    if (openPaymentsToday.length > 0) {
      list.push({
        key: "pay",
        icon: CreditCard,
        label: `${openPaymentsToday.length} ${openPaymentsToday.length === 1 ? "klant moet" : "klanten moeten"} vandaag nog betalen`,
        why: "Openstaande betalingen aangemaakt voor vandaag.",
        onClick: () => navigate("/glowpay?filter=pending"),
        tone: "warning",
      });
    }

    if (freeSlots > 0 && todaysAppts.length < 6) {
      list.push({
        key: "slot",
        icon: CalendarClock,
        label: `${freeSlots} ${freeSlots === 1 ? "lege plek" : "lege plekken"} vandaag`,
        why: "Berekend op basis van afspraken in je agenda voor vandaag.",
        onClick: () => navigate("/agenda"),
        tone: "primary",
      });
    }

    if (expiringMemberships.length > 0) {
      list.push({
        key: "mem",
        icon: Crown,
        label: `${expiringMemberships.length} ${expiringMemberships.length === 1 ? "abonnement verloopt" : "abonnementen verlopen"} binnenkort`,
        why: "Looptijd eindigt binnen 14 dagen — goed moment om te verlengen.",
        onClick: () => navigate("/abonnementen"),
        tone: "muted",
      });
    }

    if (isQuiet && list.length < 3) {
      list.push({
        key: "quiet",
        icon: Sparkles,
        label: `Rustige ${dayName} — goed moment voor een campagne`,
        why: `Slechts ${todaysAppts.length} ${todaysAppts.length === 1 ? "afspraak" : "afspraken"} ingepland vandaag.`,
        onClick: () => navigate("/marketing"),
        tone: "success",
      });
    }

    return list;
  }, [payments, appointments, memberships, navigate]);

  if (loading) {
    return <Skeleton className="h-28 rounded-2xl" />;
  }

  if (items.length === 0) return null;

  const toneClass = (tone: string) => {
    switch (tone) {
      case "warning":
        return "text-warning bg-warning/10";
      case "success":
        return "text-success bg-success/10";
      case "primary":
        return "text-primary bg-primary/10";
      default:
        return "text-muted-foreground bg-secondary";
    }
  };

  return (
    <section aria-label="Vandaag">
      <div className="flex items-end justify-between mb-3">
        <div>
          <h2 className="text-section-title">Vandaag</h2>
          <p className="text-meta mt-1">Wat aandacht verdient — nu</p>
        </div>
      </div>
      <div
        className="rounded-2xl border border-border/70 bg-card divide-y divide-border/50 overflow-hidden"
        style={{ boxShadow: "var(--shadow-sm)" }}
      >
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <button
              key={it.key}
              onClick={it.onClick}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/40 active:scale-[0.997] transition-all group"
            >
              <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0", toneClass(it.tone))}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold leading-tight text-foreground truncate">{it.label}</p>
                <p className="text-[11px] text-muted-foreground/80 mt-0.5 truncate">{it.why}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
