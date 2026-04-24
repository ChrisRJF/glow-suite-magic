import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useAppointments, useCustomers, usePaymentRefunds, useServices, useSettings } from "@/hooks/useSupabaseData";
import { usePayments } from "@/hooks/usePayments";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { formatEuro } from "@/lib/data";
import { exportCSV, exportExcel } from "@/lib/exportUtils";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Clock, Download, FileSpreadsheet, History, RotateCcw, Search, Settings, ShieldCheck, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

type RefundRequest = {
  id: string;
  payment_id: string;
  customer_id: string | null;
  amount: number;
  currency: string;
  reason: string;
  custom_reason: string | null;
  internal_note: string | null;
  notify_customer: boolean;
  status: string;
  mollie_refund_id: string | null;
  failure_reason: string | null;
  requested_by: string | null;
  approved_by: string | null;
  executed_by: string | null;
  created_at: string;
  processed_at: string | null;
};

type RefundEvent = { id: string; refund_request_id: string | null; payment_id: string | null; event_type: string; amount: number | null; reason: string | null; notes: string | null; created_at: string };

const REASONS = ["Cancelled appointment", "Duplicate payment", "Customer complaint", "Staff issue", "Booking error", "Abonnement opzegging", "Goodwill gesture", "Other"];
const STATUS_STYLES: Record<string, string> = {
  requested: "bg-warning/15 text-warning",
  needs_approval: "bg-warning/15 text-warning",
  approved: "bg-primary/15 text-primary",
  queued: "bg-primary/15 text-primary",
  pending: "bg-primary/15 text-primary",
  processing: "bg-primary/15 text-primary",
  refunded: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  rejected: "bg-destructive/15 text-destructive",
};

export default function RefundsPage() {
  const { user } = useAuth();
  const { data: payments, refetch: refetchPayments } = usePayments();
  const { data: refunds } = usePaymentRefunds();
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const { data: services } = useServices();
  const { data: settings, refetch: refetchSettings } = useSettings();
  const { hasAny, can } = useUserRole();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState("center");
  const [requests, setRequests] = useState<RefundRequest[]>([]);
  const [events, setEvents] = useState<RefundEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedPayment, setSelectedPayment] = useState<any | null>(null);
  const [form, setForm] = useState({ amount: "", reason: REASONS[0], custom_reason: "", internal_note: "", notify_customer: true });
  const [policyForm, setPolicyForm] = useState({ auto_refund_cancelled_prepaid: false, manager_max_refund: 100, require_note_mandatory: true, require_second_approval_amount: 100 });
  const searchRef = useRef<HTMLInputElement>(null);

  const canCreate = hasAny("eigenaar", "manager", "admin");
  const canExecute = hasAny("eigenaar", "admin");
  const canExport = can("reports:export");
  const setting = settings[0] as any | undefined;

  const fetchRefundOps = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [requestsRes, eventsRes] = await Promise.all([
      (supabase as any).from("refund_requests").select("*").order("created_at", { ascending: false }),
      (supabase as any).from("refund_events").select("*").order("created_at", { ascending: false }).limit(250),
    ]);
    setRequests(requestsRes.data || []);
    setEvents(eventsRes.data || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchRefundOps(); }, [fetchRefundOps]);
  useEffect(() => {
    const saved = setting?.whitelabel_branding?.refund_settings;
    if (saved) setPolicyForm({
      auto_refund_cancelled_prepaid: Boolean(saved.auto_refund_cancelled_prepaid),
      manager_max_refund: Number(saved.manager_max_refund ?? 100),
      require_note_mandatory: Boolean(saved.require_note_mandatory ?? true),
      require_second_approval_amount: Number(saved.require_second_approval_amount ?? 100),
    });
  }, [setting?.id]);

  const getCustomerName = (id: string | null) => customers.find((customer) => customer.id === id)?.name || "Onbekend";
  const getPayment = (id: string) => payments.find((payment) => payment.id === id);
  const remainingRefundable = (payment: any) => Math.max(0, Number(payment?.amount || 0) - Number(payment?.refunded_amount || 0));
  const isEligible = (payment: any) => payment?.status === "paid" && !payment?.is_demo && payment?.provider === "mollie" && payment?.mollie_payment_id && remainingRefundable(payment) > 0;

  useEffect(() => {
    const paymentId = searchParams.get("payment");
    if (!paymentId || payments.length === 0) return;
    const payment = payments.find((item) => item.id === paymentId);
    if (payment && isEligible(payment)) {
      setActiveTab("payments");
      setSelectedPayment(payment);
      setForm({ amount: remainingRefundable(payment).toFixed(2), reason: REASONS[0], custom_reason: "", internal_note: "", notify_customer: true });
    }
  }, [searchParams, payments.length]);

  const filteredPayments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments.filter((payment) => {
      const customer = getCustomerName(payment.customer_id).toLowerCase();
      return !q || customer.includes(q) || payment.mollie_payment_id?.toLowerCase().includes(q) || payment.checkout_reference?.toLowerCase().includes(q);
    }).slice(0, 40);
  }, [payments, search, customers]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const todayRefunds = requests.filter((request) => request.created_at.startsWith(today));
    const monthRefunds = requests.filter((request) => new Date(request.created_at) >= monthStart);
    return {
      open: requests.filter((request) => ["requested", "needs_approval", "approved"].includes(request.status)).length,
      today: todayRefunds.length,
      monthAmount: monthRefunds.reduce((sum, request) => sum + Number(request.amount || 0), 0),
      pendingMollie: requests.filter((request) => ["queued", "pending", "processing"].includes(request.status)).length,
      completed: requests.filter((request) => request.status === "refunded").length,
      failed: requests.filter((request) => request.status === "failed").length,
    };
  }, [requests]);

  const analytics = useMemo(() => {
    const paidRevenue = payments.filter((payment) => ["paid", "refunded"].includes(payment.status)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const refundTotal = requests.reduce((sum, request) => sum + Number(request.amount || 0), 0);
    const byReason = REASONS.map((reason) => ({ reason, count: requests.filter((request) => request.reason === reason).length, amount: requests.filter((request) => request.reason === reason).reduce((sum, request) => sum + Number(request.amount || 0), 0) })).filter((row) => row.count > 0);
    const byService = services.map((service) => {
      const amount = requests.reduce((sum, request) => {
        const payment = getPayment(request.payment_id);
        const appointment = appointments.find((appt) => appt.id === payment?.appointment_id);
        return appointment?.service_id === service.id ? sum + Number(request.amount || 0) : sum;
      }, 0);
      return { name: service.name, amount };
    }).filter((row) => row.amount > 0);
    return { refundTotal, refundPct: paidRevenue > 0 ? Math.round((refundTotal / paidRevenue) * 1000) / 10 : 0, netRevenue: paidRevenue - refundTotal, byReason, byService };
  }, [requests, payments, services, appointments]);

  const openRefund = (payment: any) => {
    if (!isEligible(payment)) { toast.error("Deze betaling is niet refundbaar."); return; }
    setSelectedPayment(payment);
    setForm({ amount: remainingRefundable(payment).toFixed(2), reason: REASONS[0], custom_reason: "", internal_note: "", notify_customer: true });
  };

  const callRefund = async (body: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke("refund-operations", { body, headers: { Authorization: `Bearer ${session?.access_token}` } });
    if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message || "Refund actie mislukt.");
    return data as any;
  };

  const submitRefund = async () => {
    if (!selectedPayment) return;
    const amount = Number(form.amount);
    if (!canCreate) { toast.error("Je hebt geen refund-rechten."); return; }
    if (!amount || amount <= 0) { toast.error("Vul een geldig bedrag in."); return; }
    if (amount > remainingRefundable(selectedPayment)) { toast.error("Bedrag is hoger dan refundbaar restant."); return; }
    if (form.reason === "Other" && !form.custom_reason.trim()) { toast.error("Vul een aangepaste reden in."); return; }
    if (policyForm.require_note_mandatory && !form.internal_note.trim()) { toast.error("Interne notitie is verplicht."); return; }
    try {
      const created = await callRefund({ action: "create_request", payment_id: selectedPayment.id, amount, reason: form.reason, custom_reason: form.custom_reason || undefined, internal_note: form.internal_note || undefined, notify_customer: form.notify_customer });
      if (canExecute && created.refund_request?.status === "approved") {
        await callRefund({ action: "execute", refund_request_id: created.refund_request.id });
        toast.success("Refund uitgevoerd via Mollie");
      } else {
        toast.success("Refundaanvraag opgeslagen");
      }
      setSelectedPayment(null);
      fetchRefundOps();
      refetchPayments();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const approveOrExecute = async (request: RefundRequest, action: "approve" | "execute" | "sync") => {
    try {
      await callRefund({ action, refund_request_id: request.id });
      toast.success(action === "approve" ? "Refund goedgekeurd" : action === "execute" ? "Refund uitgevoerd" : "Status bijgewerkt");
      fetchRefundOps();
      refetchPayments();
    } catch (error) { toast.error((error as Error).message); }
  };

  const savePolicies = async () => {
    if (!setting || !canExecute) return;
    const branding = { ...(setting.whitelabel_branding || {}), refund_settings: policyForm };
    const { error } = await supabase.from("settings").update({ whitelabel_branding: branding as any }).eq("id", setting.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Refundbeleid opgeslagen");
    refetchSettings();
  };

  const exportRows = () => {
    const headers = ["Datum", "Klant", "Betaling", "Bedrag", "Status", "Reden", "Mollie refund ID", "Notitie"];
    const rows = requests.map((request) => [new Date(request.created_at).toLocaleDateString("nl-NL"), getCustomerName(request.customer_id), request.payment_id, formatEuro(Number(request.amount)), request.status, request.custom_reason || request.reason, request.mollie_refund_id || "—", request.internal_note || "—"]);
    return { headers, rows };
  };

  const handleExport = (format: "csv" | "excel") => {
    if (!canExport) { toast.error("Je hebt geen rechten om te exporteren."); return; }
    const { headers, rows } = exportRows();
    const date = new Date().toISOString().slice(0, 10);
    if (format === "csv") exportCSV(headers, rows, `glowsuite-refunds-${date}.csv`);
    else exportExcel(headers, rows, `glowsuite-refunds-${date}.xls`);
    toast.success("Refundrapport geëxporteerd");
  };

  const tabs = [["center", "Center"], ["payments", "Zoek betaling"], ["history", "Historie"], ["reports", "Rapportage"], ["policies", "Policies"]];

  return (
    <AppLayout title="Refunds" subtitle="Professioneel refundbeheer voor live Mollie-betalingen" actions={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => { setActiveTab("payments"); setTimeout(() => searchRef.current?.focus(), 50); }}><Search className="w-4 h-4" /> Search payment</Button>{canCreate && <Button variant="gradient" size="sm" onClick={() => { setActiveTab("payments"); setTimeout(() => searchRef.current?.focus(), 50); }}><RotateCcw className="w-4 h-4" /> New refund</Button>}</div>}>
      {selectedPayment && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 backdrop-blur-sm p-3" onClick={() => setSelectedPayment(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-4 sm:p-6" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4"><h2 className="text-lg font-semibold">Refund uitvoeren</h2><p className="text-sm text-muted-foreground">{getCustomerName(selectedPayment.customer_id)} · refundbaar {formatEuro(remainingRefundable(selectedPayment))}</p></div>
            <div className="grid gap-3">
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Bedrag</span><input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm" /></label>
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Reden</span><select value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm">{REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}</select></label>
              {form.reason === "Other" && <input value={form.custom_reason} onChange={(event) => setForm({ ...form, custom_reason: event.target.value })} placeholder="Aangepaste reden" className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm" />}
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Interne notitie</span><textarea value={form.internal_note} onChange={(event) => setForm({ ...form, internal_note: event.target.value })} className="min-h-20 w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm" /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.notify_customer} onChange={(event) => setForm({ ...form, notify_customer: event.target.checked })} /> Klant notificeren</label>
            </div>
            <div className="mt-5 flex gap-2"><Button variant="outline" className="flex-1" onClick={() => setSelectedPayment(null)}>Annuleren</Button><Button variant="gradient" className="flex-1" onClick={submitRefund}>{canExecute ? "Refund uitvoeren" : "Aanvragen"}</Button></div>
          </div>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-2">
        {tabs.map(([key, label]) => <button key={key} onClick={() => setActiveTab(key)} className={cn("rounded-xl px-3 py-2 text-sm whitespace-nowrap transition-colors", activeTab === key ? "bg-primary text-primary-foreground" : "bg-secondary/50 text-muted-foreground hover:text-foreground")}>{label}</button>)}
      </div>

      {activeTab === "center" && <div className="grid gap-4">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">{[
          ["Open aanvragen", stats.open, Clock], ["Refunds vandaag", stats.today, RotateCcw], ["Deze maand", formatEuro(stats.monthAmount), Download], ["Pending Mollie", stats.pendingMollie, AlertTriangle], ["Afgerond", stats.completed, CheckCircle2], ["Mislukt", stats.failed, XCircle],
        ].map(([label, value, Icon]: any) => <div key={label} className="stat-card"><Icon className="w-4 h-4 text-primary" /><p className="text-2xl font-bold mt-3 leading-none">{value}</p><p className="text-xs text-muted-foreground mt-2">{label}</p></div>)}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2"><Button variant="outline" onClick={() => setActiveTab("payments")}><RotateCcw className="w-4 h-4" /> New refund</Button><Button variant="outline" onClick={() => { setActiveTab("payments"); setTimeout(() => searchRef.current?.focus(), 50); }}><Search className="w-4 h-4" /> Search payment</Button><Button variant="outline" onClick={() => handleExport("csv")}><Download className="w-4 h-4" /> Export CSV</Button><Button variant="outline" onClick={() => setActiveTab("policies")}><Settings className="w-4 h-4" /> Policies</Button></div>
      </div>}

      {activeTab === "payments" && <div className="glass-card p-4 sm:p-6"><div className="relative mb-4"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Zoek klant, Mollie ID of referentie" className="w-full rounded-xl border border-border bg-secondary/30 py-2 pl-9 pr-3 text-sm" /></div><div className="space-y-2">{filteredPayments.map((payment) => <div key={payment.id} className="rounded-xl border border-border bg-secondary/20 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium truncate">{getCustomerName(payment.customer_id)}</p><p className="text-xs text-muted-foreground">{new Date(payment.created_at).toLocaleDateString("nl-NL")} · {payment.status} · refundbaar {formatEuro(remainingRefundable(payment))}</p></div><div className="text-right"><p className="text-sm font-semibold">{formatEuro(Number(payment.amount))}</p>{isEligible(payment) ? <span className="text-[11px] text-success">Live refundbaar</span> : <span className="text-[11px] text-muted-foreground">Niet refundbaar</span>}</div></div><div className="mt-3 flex flex-wrap gap-2">{isEligible(payment) && canCreate && <><Button size="sm" variant="gradient" onClick={() => openRefund(payment)}><RotateCcw className="w-3.5 h-3.5" /> Partial refund</Button><Button size="sm" variant="outline" onClick={() => { setSelectedPayment(payment); setForm({ ...form, amount: remainingRefundable(payment).toFixed(2) }); }}><RotateCcw className="w-3.5 h-3.5" /> Full refund</Button></>}<Button size="sm" variant="outline" onClick={() => { setSearch(payment.mollie_payment_id || payment.id); setActiveTab("history"); }}><History className="w-3.5 h-3.5" /> Refund history</Button></div></div>)}{filteredPayments.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Geen betalingen gevonden</p>}</div></div>}

      {activeTab === "history" && <div className="glass-card p-4 sm:p-6"><h3 className="mb-4 text-sm font-semibold">Refund historie</h3><div className="space-y-2">{requests.map((request) => <div key={request.id} className="rounded-xl border border-border bg-secondary/20 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{getCustomerName(request.customer_id)}</p><p className="text-xs text-muted-foreground">{request.custom_reason || request.reason} · {new Date(request.created_at).toLocaleString("nl-NL")}</p></div><div className="text-right"><p className="text-sm font-semibold">{formatEuro(Number(request.amount))}</p><span className={cn("rounded-lg px-2 py-0.5 text-[11px] font-medium", STATUS_STYLES[request.status] || STATUS_STYLES.requested)}>{request.status}</span></div></div><div className="mt-3 flex flex-wrap gap-2">{canExecute && ["requested", "needs_approval"].includes(request.status) && <Button size="sm" variant="outline" onClick={() => approveOrExecute(request, "approve")}><ShieldCheck className="w-3.5 h-3.5" /> Goedkeuren</Button>}{canExecute && ["approved"].includes(request.status) && <Button size="sm" variant="gradient" onClick={() => approveOrExecute(request, "execute")}><RotateCcw className="w-3.5 h-3.5" /> Uitvoeren</Button>}{request.mollie_refund_id && <Button size="sm" variant="outline" onClick={() => approveOrExecute(request, "sync")}><Clock className="w-3.5 h-3.5" /> Sync status</Button>}</div></div>)}{!loading && requests.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nog geen refunds</p>}</div></div>}

      {activeTab === "reports" && <div className="grid gap-4"><div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><div className="stat-card"><p className="text-2xl font-bold">{formatEuro(analytics.refundTotal)}</p><p className="text-xs text-muted-foreground mt-2">Refund totaal</p></div><div className="stat-card"><p className="text-2xl font-bold">{analytics.refundPct}%</p><p className="text-xs text-muted-foreground mt-2">Refund percentage</p></div><div className="stat-card"><p className="text-2xl font-bold">{formatEuro(analytics.netRevenue)}</p><p className="text-xs text-muted-foreground mt-2">Netto omzet na refunds</p></div></div><div className="grid gap-4 lg:grid-cols-2"><div className="glass-card p-4"><h3 className="mb-3 text-sm font-semibold">Top refund redenen</h3>{analytics.byReason.map((row) => <div key={row.reason} className="flex justify-between border-b border-border/50 py-2 text-sm"><span>{row.reason}</span><span>{row.count} · {formatEuro(row.amount)}</span></div>)}</div><div className="glass-card p-4"><h3 className="mb-3 text-sm font-semibold">Refunds per behandeling</h3>{analytics.byService.map((row) => <div key={row.name} className="flex justify-between border-b border-border/50 py-2 text-sm"><span>{row.name}</span><span>{formatEuro(row.amount)}</span></div>)}</div></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => handleExport("csv")}><Download className="w-4 h-4" /> CSV export</Button><Button variant="outline" onClick={() => handleExport("excel")}><FileSpreadsheet className="w-4 h-4" /> Excel export</Button></div></div>}

      {activeTab === "policies" && <div className="glass-card p-4 sm:p-6"><h3 className="mb-4 text-sm font-semibold">Refund policies</h3><div className="grid gap-3 sm:grid-cols-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canExecute} checked={policyForm.auto_refund_cancelled_prepaid} onChange={(event) => setPolicyForm({ ...policyForm, auto_refund_cancelled_prepaid: event.target.checked })} /> Auto refund bij geannuleerde prepaid boeking</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canExecute} checked={policyForm.require_note_mandatory} onChange={(event) => setPolicyForm({ ...policyForm, require_note_mandatory: event.target.checked })} /> Interne notitie verplicht</label><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Manager max refund €</span><input type="number" disabled={!canExecute} value={policyForm.manager_max_refund} onChange={(event) => setPolicyForm({ ...policyForm, manager_max_refund: Number(event.target.value) })} className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm" /></label><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Tweede approval vanaf €</span><input type="number" disabled={!canExecute} value={policyForm.require_second_approval_amount} onChange={(event) => setPolicyForm({ ...policyForm, require_second_approval_amount: Number(event.target.value) })} className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm" /></label></div>{canExecute && <Button className="mt-5" variant="gradient" onClick={savePolicies}>Policies opslaan</Button>}</div>}

      {activeTab === "history" && events.length > 0 && <div className="glass-card p-4 sm:p-6"><h3 className="mb-4 text-sm font-semibold">Audit trail</h3><div className="space-y-2">{events.slice(0, 20).map((event) => <div key={event.id} className="flex items-start justify-between gap-3 rounded-xl bg-secondary/20 p-3 text-sm"><div><p className="font-medium">{event.event_type}</p><p className="text-xs text-muted-foreground">{event.notes || event.reason || "Audit event"}</p></div><span className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString("nl-NL")}</span></div>)}</div></div>}
    </AppLayout>
  );
}
