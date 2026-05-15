import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { usePayments } from "@/hooks/usePayments";
import { useCustomerMemberships, usePaymentRefunds, useAppointments, useCustomers } from "@/hooks/useSupabaseData";
import { formatEuro } from "@/lib/data";
import { CreditCard, Smartphone, Wallet, Banknote, RefreshCcw, ShieldCheck, Crown, Repeat } from "lucide-react";

function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); }
function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString(); }

export function PremiumOwnerMetrics() {
  const navigate = useNavigate();
  const { data: payments } = usePayments();
  const { data: refunds } = usePaymentRefunds();
  const { data: memberships } = useCustomerMemberships();
  const { data: appointments } = useAppointments();
  const { data: customers } = useCustomers();

  const m = useMemo(() => {
    const monthStart = startOfMonth();
    const dayStart = startOfDay();
    const paid = (payments as any[]).filter((p) => p.status === "paid");
    const month = paid.filter((p) => (p.paid_at || p.created_at) >= monthStart);
    const today = paid.filter((p) => (p.paid_at || p.created_at) >= dayStart);

    const isTerminal = (p: any) => p.method === "terminal" || p.payment_type === "terminal" || p.provider === "viva-terminal" || (p.metadata && p.metadata.source === "terminal");
    const onlineMonth = month.filter((p) => !isTerminal(p)).reduce((s, p) => s + Number(p.amount || 0), 0);
    const terminalMonth = month.filter(isTerminal).reduce((s, p) => s + Number(p.amount || 0), 0);
    const todayTotal = today.reduce((s, p) => s + Number(p.amount || 0), 0);
    const monthTotal = month.reduce((s, p) => s + Number(p.amount || 0), 0);

    const refundedMonth = (refunds as any[]).filter((r) => (r.created_at || "") >= monthStart).reduce((s, r) => s + Number(r.amount || 0), 0);

    // Estimated next payout = last 7d paid online minus refunds
    const sevenAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const recentOnline = paid.filter((p) => !isTerminal(p) && (p.paid_at || p.created_at) >= sevenAgo).reduce((s, p) => s + Number(p.amount || 0), 0);
    const estimatedPayout = Math.max(0, recentOnline - refundedMonth * 0.1);

    const activeMembers = (memberships as any[]).filter((mm) => mm.status === "active").length;

    // No-shows prevented: customers with prior no-shows that DID show this month
    const monthAppts = (appointments as any[]).filter((a) => (a.appointment_date || "") >= monthStart && a.status === "voltooid");
    const preventedNoShows = monthAppts.filter((a) => {
      const c = (customers as any[]).find((x) => x.id === a.customer_id);
      return c && (c.no_show_count || 0) > 0;
    }).length;

    const returning = (customers as any[]).filter((c) => (c.total_visits || 0) > 1).length;

    return { todayTotal, monthTotal, onlineMonth, terminalMonth, refundedMonth, estimatedPayout, activeMembers, preventedNoShows, returning };
  }, [payments, refunds, memberships, appointments, customers]);

  const Tile = ({ icon: Icon, label, value, hint, onClick, accent }: any) => (
    <button onClick={onClick} className="text-left p-4 rounded-2xl border border-border/70 bg-card hover:border-primary/30 hover:-translate-y-0.5 transition-all" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${accent || "text-primary"}`} />
        <span className="text-eyebrow truncate">{label}</span>
      </div>
      <p className="text-metric-sm tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </button>
  );

  return (
    <section>
      <div className="flex items-end justify-between mb-4">
        <div>
          <h2 className="text-section-title">Premium overzicht</h2>
          <p className="text-meta mt-1">Eenvoudige cijfers die er voor jou toe doen</p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <Tile icon={Banknote} label="Omzet vandaag" value={formatEuro(m.todayTotal)} hint="Alle betalingen" onClick={() => navigate("/rapporten?type=omzet")} accent="text-success" />
        <Tile icon={Wallet} label="Omzet deze maand" value={formatEuro(m.monthTotal)} onClick={() => navigate("/rapporten?type=omzet")} />
        <Tile icon={CreditCard} label="Online" value={formatEuro(m.onlineMonth)} hint="Maand · iDEAL/cards" onClick={() => navigate("/glowpay")} />
        <Tile icon={Smartphone} label="Pinapparaat" value={formatEuro(m.terminalMonth)} hint="Maand · terminal" onClick={() => navigate("/kassa")} />
        <Tile icon={RefreshCcw} label="Refunds" value={formatEuro(m.refundedMonth)} hint="Deze maand" onClick={() => navigate("/refunds")} accent="text-destructive" />
        <Tile icon={ShieldCheck} label="No-shows voorkomen" value={String(m.preventedNoShows)} hint="Risico-klanten kwamen toch" onClick={() => navigate("/agenda")} accent="text-success" />
        <Tile icon={Crown} label="Actieve leden" value={String(m.activeMembers)} onClick={() => navigate("/abonnementen")} />
        <Tile icon={Repeat} label="Volgende uitbetaling" value={`±${formatEuro(m.estimatedPayout)}`} hint="Schatting o.b.v. afgelopen 7 dagen" onClick={() => navigate("/glowpay")} accent="text-success" />
      </div>
    </section>
  );
}
