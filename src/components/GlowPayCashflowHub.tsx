import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Euro, Clock, Wallet, Shield, Sparkles, ArrowRight,
  TrendingUp, AlertTriangle, CreditCard, Smartphone,
  CheckCircle2, type LucideIcon, Banknote, ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { formatEuro } from "@/lib/data";
import { PremiumEmptyState } from "@/components/PremiumEmptyState";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Payment = {
  id: string;
  amount: number | string;
  status: string;
  payment_type?: string | null;
  created_at: string;
  paid_at?: string | null;
};

type Appointment = {
  id: string;
  payment_required?: boolean | null;
  payment_status?: string | null;
  deposit_amount?: number | string | null;
};

type Payout = {
  id: string;
  net_amount: number;
  gross_amount: number;
  fee_amount: number;
  payout_status: string;
  payout_date: string | null;
  synced_at: string;
  mismatch: boolean;
};

type MerchantSummary = {
  payouts_enabled: boolean;
  terminals_enabled: boolean;
  online_payments_enabled: boolean;
  kyc_status: string | null;
  onboarding_status: string;
} | null;

interface Props {
  payments: Payment[];
  appointments: Appointment[];
  onOpenLinks: () => void;
  onOpenPayments: () => void;
}

/**
 * Premium cashflow hub for salon owners.
 * Pure presentation layer over existing payment/payout data.
 */
export function GlowPayCashflowHub({ payments, appointments, onOpenLinks, onOpenPayments }: Props) {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [merchant, setMerchant] = useState<MerchantSummary>(null);
  const [terminalCount, setTerminalCount] = useState<number>(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ data: po }, { data: m }, { count: tc }] = await Promise.all([
        supabase
          .from("viva_payouts")
          .select("id, net_amount, gross_amount, fee_amount, payout_status, payout_date, synced_at, mismatch")
          .eq("user_id", user.id)
          .eq("is_demo", demoMode)
          .order("payout_date", { ascending: false, nullsFirst: false })
          .limit(6),
        supabase
          .from("glowpay_connected_merchants")
          .select("payouts_enabled, terminals_enabled, online_payments_enabled, kyc_status, onboarding_status")
          .eq("user_id", user.id)
          .eq("is_demo", demoMode)
          .maybeSingle(),
        supabase
          .from("viva_terminals")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_demo", demoMode),
      ]);
      if (cancelled) return;
      setPayouts((po || []) as Payout[]);
      setMerchant((m as MerchantSummary) ?? null);
      setTerminalCount(tc ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, demoMode]);

  const todayStr = new Date().toISOString().split("T")[0];

  const stats = useMemo(() => {
    const todayPaid = payments
      .filter((p) => p.status === "paid" && (p.paid_at || p.created_at).startsWith(todayStr))
      .reduce((s, p) => s + Number(p.amount), 0);

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    weekStart.setHours(0, 0, 0, 0);

    const weekPaid = payments
      .filter((p) => p.status === "paid" && new Date(p.paid_at || p.created_at) >= weekStart)
      .reduce((s, p) => s + Number(p.amount), 0);

    const open = payments
      .filter((p) => p.status === "pending")
      .reduce((s, p) => s + Number(p.amount), 0);

    const autoCollected = payments
      .filter((p) => p.status === "paid" && p.payment_type === "deposit")
      .reduce((s, p) => s + Number(p.amount), 0);

    const noShowProtected = appointments.filter(
      (a) =>
        a.payment_required &&
        (a.payment_status === "betaald" || (a.deposit_amount && Number(a.deposit_amount) > 0)),
    ).length;

    const nextPayout = payouts.find((p) => p.payout_status !== "paid") || payouts[0];

    return { todayPaid, weekPaid, open, autoCollected, noShowProtected, nextPayout };
  }, [payments, appointments, payouts, todayStr]);

  const metricCards: Array<{
    label: string;
    value: string;
    sub?: string;
    icon: LucideIcon;
    tone: "success" | "warning" | "primary" | "muted";
    onClick?: () => void;
  }> = [
    {
      label: "Vandaag verdiend",
      value: formatEuro(stats.todayPaid),
      icon: Euro,
      tone: "success",
      onClick: onOpenPayments,
    },
    {
      label: "Deze week onderweg",
      value: formatEuro(stats.weekPaid),
      sub: "Naar uitbetaling",
      icon: TrendingUp,
      tone: "primary",
      onClick: onOpenPayments,
    },
    {
      label: "Volgende uitbetaling",
      value: stats.nextPayout ? formatEuro(Number(stats.nextPayout.net_amount)) : "—",
      sub: stats.nextPayout ? formatPayoutWhen(stats.nextPayout) : "Nog geen uitbetaling",
      icon: Banknote,
      tone: "primary",
    },
    {
      label: "Open betalingen",
      value: formatEuro(stats.open),
      sub: stats.open > 0 ? "Wachten op klant" : "Alles bijgewerkt",
      icon: Clock,
      tone: stats.open > 0 ? "warning" : "muted",
      onClick: onOpenPayments,
    },
    {
      label: "Automatisch geïncasseerd",
      value: formatEuro(stats.autoCollected),
      sub: "Aanbetalingen & deposits",
      icon: Wallet,
      tone: "success",
    },
    {
      label: "No-shows voorkomen",
      value: String(stats.noShowProtected),
      sub: "Beschermde afspraken",
      icon: ShieldCheck,
      tone: "primary",
    },
  ];

  // Action center
  const actions = useMemo(() => buildActions({ merchant, terminalCount, openCount: payments.filter(p => p.status === "pending").length, failedCount: payments.filter(p => p.status === "failed").length }), [merchant, terminalCount, payments]);

  return (
    <section aria-label="GlowPay overzicht" className="space-y-6">
      {/* Top metric grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {metricCards.map((m, i) => (
          <MetricCard key={m.label} {...m} delay={i * 60} />
        ))}
      </div>

      {/* Two column on desktop: payout timeline + action center */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <PayoutTimelineCard payouts={payouts} onGetStarted={onOpenPayments} />
        </div>
        <div>
          <ActionCenterCard actions={actions} onOpenLinks={onOpenLinks} />
        </div>
      </div>
    </section>
  );
}

/* ---------------- subcomponents ---------------- */

function MetricCard({
  label, value, sub, icon: Icon, tone, onClick, delay = 0,
}: {
  label: string; value: string; sub?: string; icon: LucideIcon;
  tone: "success" | "warning" | "primary" | "muted";
  onClick?: () => void; delay?: number;
}) {
  const toneClass =
    tone === "success" ? "text-success bg-success/10 ring-success/15"
    : tone === "warning" ? "text-warning bg-warning/10 ring-warning/15"
    : tone === "primary" ? "text-primary bg-primary/10 ring-primary/15"
    : "text-muted-foreground bg-secondary/60 ring-border/40";

  const Comp: any = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "group relative w-full text-left rounded-2xl border border-border/40 bg-card/60 backdrop-blur-sm",
        "p-4 sm:p-5 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] hover:shadow-[0_4px_18px_-8px_hsl(var(--foreground)/0.12)]",
        "transition-all duration-200 opacity-0 animate-fade-in-up",
        onClick && "hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <div className="flex items-start justify-between mb-3.5">
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center ring-1", toneClass)}>
          <Icon className="w-4 h-4" strokeWidth={1.85} />
        </div>
        {onClick && (
          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
        )}
      </div>
      <p className="text-[11px] font-medium text-muted-foreground tracking-wide uppercase">{label}</p>
      <p className="text-2xl font-semibold tabular-nums tracking-tight mt-1">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground/80 mt-1.5">{sub}</p>}
    </Comp>
  );
}

function PayoutTimelineCard({ payouts, onGetStarted }: { payouts: Payout[]; onGetStarted: () => void }) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-5 sm:p-6 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold tracking-tight flex items-center gap-2">
            <Banknote className="w-4 h-4 text-primary" /> Uitbetalingen
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">Volg je geld van betaling tot bankrekening</p>
        </div>
      </div>

      {payouts.length === 0 ? (
        <PremiumEmptyState
          icon={Sparkles}
          title="Je eerste uitbetaling komt eraan"
          description="Zodra je betalingen ontvangt, verschijnt hier automatisch je payout-tijdlijn."
          cta={{ label: "Bekijk betalingen", onClick: onGetStarted, variant: "outline" }}
        />
      ) : (
        <ol className="relative space-y-1">
          <span aria-hidden className="absolute left-[7px] top-2 bottom-2 w-px bg-border/60" />
          {payouts.map((p, i) => {
            const ui = payoutUi(p);
            return (
              <li key={p.id} className="relative flex items-start gap-4 py-2.5 pl-0">
                <span className={cn("relative z-10 mt-1.5 w-3.5 h-3.5 rounded-full ring-4 ring-background", ui.dot)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium truncate">{ui.label}</p>
                    <p className="text-sm font-semibold tabular-nums">{formatEuro(Number(p.net_amount))}</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {ui.when}
                    {p.mismatch && <span className="ml-2 text-warning">· Controle nodig</span>}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function ActionCenterCard({
  actions,
  onOpenLinks,
}: {
  actions: ActionItem[];
  onOpenLinks: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-5 sm:p-6 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] h-full flex flex-col">
      <div className="mb-4">
        <h2 className="text-sm font-semibold tracking-tight flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" /> Actie nodig
        </h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">GlowSuite regelt de rest automatisch</p>
      </div>

      {actions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-6">
            <div className="w-10 h-10 rounded-full bg-success/10 ring-1 ring-success/20 mx-auto flex items-center justify-center mb-2">
              <CheckCircle2 className="w-5 h-5 text-success" />
            </div>
            <p className="text-sm font-medium">Alles loopt automatisch</p>
            <p className="text-[11px] text-muted-foreground mt-1">Geen openstaande acties.</p>
          </div>
        </div>
      ) : (
        <ul className="space-y-2.5 flex-1">
          {actions.map((a) => (
            <li
              key={a.id}
              className="rounded-xl border border-border/40 bg-background/60 p-3.5 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center ring-1 shrink-0",
                  a.priority === "high" ? "bg-warning/10 text-warning ring-warning/20" : "bg-primary/10 text-primary ring-primary/15")}>
                  <a.icon className="w-4 h-4" strokeWidth={1.85} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug">{a.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{a.description}</p>
                  <div className="mt-2.5">
                    {a.to ? (
                      <Button asChild size="sm" variant="outline" className="rounded-lg h-8 text-xs">
                        <Link to={a.to}>{a.cta} <ArrowRight className="w-3 h-3" /></Link>
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="rounded-lg h-8 text-xs" onClick={a.onClick || onOpenLinks}>
                        {a.cta} <ArrowRight className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- helpers ---------------- */

type ActionItem = {
  id: string;
  title: string;
  description: string;
  cta: string;
  icon: LucideIcon;
  priority: "high" | "normal";
  to?: string;
  onClick?: () => void;
};

function buildActions({
  merchant, terminalCount, openCount, failedCount,
}: {
  merchant: MerchantSummary; terminalCount: number; openCount: number; failedCount: number;
}): ActionItem[] {
  const out: ActionItem[] = [];

  if (!merchant || merchant.onboarding_status !== "completed") {
    out.push({
      id: "activate-glowpay",
      title: "GlowPay activeren",
      description: "Eenmalige setup om betalingen en uitbetalingen te starten.",
      cta: "Activeren",
      icon: CreditCard,
      priority: "high",
      to: "/instellingen?tab=betalingen",
    });
  } else if (merchant.kyc_status && merchant.kyc_status !== "approved") {
    out.push({
      id: "kyc",
      title: "Identiteitscontrole afronden",
      description: "Korte verificatie zodat uitbetalingen door kunnen lopen.",
      cta: "Afronden",
      icon: Shield,
      priority: "high",
      to: "/instellingen?tab=betalingen",
    });
  }

  if (merchant?.onboarding_status === "completed" && terminalCount === 0) {
    out.push({
      id: "terminal",
      title: "Pinapparaat koppelen",
      description: "Reken in de salon snel af op een vertrouwd pinapparaat.",
      cta: "Koppelen",
      icon: Smartphone,
      priority: "normal",
      to: "/instellingen?tab=betalingen",
    });
  }

  if (failedCount > 0) {
    out.push({
      id: "failed",
      title: "Controle nodig op betalingen",
      description: `${failedCount} betaling${failedCount === 1 ? "" : "en"} hebben aandacht nodig.`,
      cta: "Bekijken",
      icon: AlertTriangle,
      priority: "high",
      to: "/glowpay?tab=betalingen",
    });
  }

  if (openCount > 0) {
    out.push({
      id: "open",
      title: "Open betalingen herinneren",
      description: `${openCount} klant${openCount === 1 ? "" : "en"} hebben nog niet betaald.`,
      cta: "Verstuur betaalverzoek",
      icon: Clock,
      priority: "normal",
      to: "/glowpay?tab=betaallinks",
    });
  }

  return out.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "high" ? -1 : 1)).slice(0, 4);
}

function payoutUi(p: Payout): { label: string; when: string; dot: string } {
  const status = (p.payout_status || "").toLowerCase();
  const dateStr = p.payout_date
    ? new Date(p.payout_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })
    : new Date(p.synced_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });

  if (status === "paid" || status === "completed") {
    return { label: "Uitbetaald", when: `Op ${dateStr} naar je rekening`, dot: "bg-success" };
  }
  if (p.mismatch) {
    return { label: "Controle nodig", when: `Sinds ${dateStr}`, dot: "bg-warning" };
  }
  if (status === "processing" || status === "pending") {
    return { label: "Onderweg naar uitbetaling", when: `Verwacht rond ${dateStr}`, dot: "bg-primary" };
  }
  return { label: "Verwerkt", when: dateStr, dot: "bg-muted-foreground/50" };
}

function formatPayoutWhen(p: Payout): string {
  const dateStr = p.payout_date
    ? new Date(p.payout_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })
    : null;
  const status = (p.payout_status || "").toLowerCase();
  if (status === "paid" || status === "completed") return dateStr ? `Uitbetaald op ${dateStr}` : "Uitbetaald";
  if (dateStr) return `Verwacht rond ${dateStr}`;
  return "Onderweg";
}
