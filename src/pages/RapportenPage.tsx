import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppointments, useServices, useProducts, useCustomers, usePaymentRefunds } from "@/hooks/useSupabaseData";
import { usePayments } from "@/hooks/usePayments";
import { exportCSV, exportPDF } from "@/lib/exportUtils";
import { buildReports, eur, rangeForPreset, trendClass, trendLabel, type DataMode, type DatePreset } from "@/lib/reporting";
import { BarChart3, Users, TrendingUp, Clock, Download, FileText, Filter, CalendarDays, Euro, RefreshCw, Target } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/useUserRole";

type ReportType = "omzet" | "afspraken" | "klanten" | "diensten" | "producten" | "betalingen" | "btw" | "export";
type ExportType = "omzet" | "klanten" | "afspraken" | "refunds" | "maandrapport";

const datePresets: { key: DatePreset; label: string }[] = [
  { key: "vandaag", label: "Vandaag" },
  { key: "7d", label: "7 dagen" },
  { key: "30d", label: "30 dagen" },
  { key: "deze_maand", label: "Deze maand" },
  { key: "vorige_maand", label: "Vorige maand" },
  { key: "custom", label: "Custom" },
];

export default function RapportenPage() {
  const { data: appointments, loading: appointmentsLoading } = useAppointments();
  const { data: services, loading: servicesLoading } = useServices();
  const { data: products, loading: productsLoading } = useProducts();
  const { data: customers, loading: customersLoading } = useCustomers();
  const { data: payments, loading: paymentsLoading } = usePayments();
  const { data: refunds, loading: refundsLoading } = usePaymentRefunds();
  const { can } = useUserRole();
  const [preset, setPreset] = useState<DatePreset>("deze_maand");
  const [dateFrom, setDateFrom] = useState(() => rangeForPreset("deze_maand").from);
  const [dateTo, setDateTo] = useState(() => rangeForPreset("deze_maand").to);
  const [dataMode, setDataMode] = useState<DataMode>("live");
  const [searchParams] = useSearchParams();
  const [reportType, setReportType] = useState<ReportType>(() => {
    const t = searchParams.get("type");
    return (["omzet", "afspraken", "klanten", "diensten", "producten", "betalingen", "btw", "export"] as ReportType[]).includes(t as ReportType) ? (t as ReportType) : "omzet";
  });
  const loading = appointmentsLoading || servicesLoading || productsLoading || customersLoading || paymentsLoading || refundsLoading;
  const range = useMemo(() => rangeForPreset(preset, dateFrom, dateTo), [preset, dateFrom, dateTo]);
  const report = useMemo(() => buildReports({ appointments, customers, services, payments, refunds, mode: dataMode, from: range.from, to: range.to }), [appointments, customers, services, payments, refunds, dataMode, range.from, range.to]);

  const setPresetRange = (next: DatePreset) => {
    setPreset(next);
    const nextRange = rangeForPreset(next, dateFrom, dateTo);
    if (next !== "custom") {
      setDateFrom(nextRange.from);
      setDateTo(nextRange.to);
    }
  };

  const stats = [
    { label: "Vandaag omzet", value: eur(report.revenue.today), icon: Euro, trend: "alleen paid" },
    { label: "Deze maand", value: eur(report.revenue.month), icon: BarChart3, trend: trendLabel(report.revenue.trend), trendValue: report.revenue.trend },
    { label: "Openstaand", value: eur(report.revenue.openAmount), icon: Clock, trend: `${report.rows.openAppointments.length} afspraken` },
    { label: "Refunds", value: eur(report.revenue.refundTotal), icon: RefreshCw, trend: "apart verwerkt" },
  ];

  const reportTabs: { key: ReportType; label: string }[] = [
    { key: "omzet", label: "Omzet" },
    { key: "afspraken", label: "Afspraken" },
    { key: "klanten", label: "Klanten" },
    { key: "diensten", label: "Diensten" },
    { key: "producten", label: "Producten" },
    { key: "betalingen", label: "Betalingen" },
    { key: "btw", label: "BTW" },
    { key: "export", label: "Export" },
  ];

  const exportData = (type: ExportType): { title: string; headers: string[]; rows: string[][] } => {
    if (type === "klanten") return {
      title: "Klantenlijst",
      headers: ["Naam", "E-mail", "Telefoon", "Bezoeken", "Lifetime value", "Laatste bezoek"],
      rows: report.rows.customerRevenue.map((c) => [c.name, c.email || "—", c.phone || "—", String(c.visits), eur(c.ltv), c.lastVisit ? new Date(c.lastVisit).toLocaleDateString("nl-NL") : "—"]),
    };
    if (type === "afspraken") return {
      title: "Afsprakenlijst",
      headers: ["Datum", "Tijd", "Klant", "Behandeling", "Status", "Waarde", "Betaalstatus"],
      rows: report.rows.validPeriodAppointments.map((a) => [
        new Date(a.appointment_date).toLocaleDateString("nl-NL"),
        new Date(a.appointment_date).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }),
        customers.find((c) => c.id === a.customer_id)?.name || "Onbekend",
        services.find((s) => s.id === a.service_id)?.name || "—",
        a.status,
        eur(Number(a.price) || 0),
        a.payment_status || "—",
      ]),
    };
    if (type === "refunds") return {
      title: "Refunds",
      headers: ["Datum", "Bedrag", "Status", "Reden", "Mollie refund ID"],
      rows: report.rows.periodRefunds.map((r) => [new Date(r.created_at).toLocaleDateString("nl-NL"), eur(Number(r.amount) || 0), r.status, r.reason || "—", r.mollie_refund_id || "—"]),
    };
    if (type === "maandrapport") return {
      title: "GlowSuite maandrapport",
      headers: ["Metric", "Waarde"],
      rows: [
        ["Vandaag omzet", eur(report.revenue.today)], ["Deze week omzet", eur(report.revenue.week)], ["Deze maand omzet", eur(report.revenue.month)],
        ["Lifetime omzet", eur(report.revenue.lifetime)], ["Gemiddelde orderwaarde", eur(report.revenue.averageOrder)], ["Openstaand bedrag", eur(report.revenue.openAmount)],
        ["Refund totaal", eur(report.revenue.refundTotal)], ["Afspraken vandaag", String(report.appointments.today)], ["No-show percentage", `${report.appointments.noShowPct}%`],
        ["Nieuwe klanten deze maand", String(report.customers.newThisMonth)], ["Terugkerende klanten", `${report.customers.returningPct}%`], ["Verwachte omzet komende 7 dagen", eur(report.wow.upcoming7Revenue)],
      ],
    };
    return {
      title: "Omzetrapport",
      headers: ["Datum", "Klant", "Bedrag", "Methode", "Status", "Referentie"],
      rows: report.rows.periodPayments.map((p) => [
        new Date(p.created_at).toLocaleDateString("nl-NL"),
        customers.find((c) => c.id === p.customer_id)?.name || "Onbekend",
        eur(Number(p.amount) || 0),
        p.mollie_method || p.method || p.payment_method || "—",
        p.status,
        p.checkout_reference || p.mollie_payment_id || "—",
      ]),
    };
  };

  const handleExport = (type: ExportType, format: "csv" | "pdf" = "csv") => {
    if (!can("reports:export")) { toast.error("Je hebt geen rechten om rapporten te exporteren."); return; }
    const { title, headers, rows } = exportData(type);
    const dateStr = new Date().toISOString().split("T")[0];
    if (format === "pdf") exportPDF(title, headers, rows, `glowsuite-${type}-${dateStr}.pdf`);
    else exportCSV(headers, rows, `glowsuite-${type}-${dateStr}.csv`);
    toast.success(`${title} geëxporteerd`);
  };

  return (
    <AppLayout title="Rapporten" subtitle="Echte cijfers uit betalingen, afspraken en klanten"
    >
      <div className="grid gap-8">
        <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-secondary/20 border border-border/50">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <div className="flex flex-wrap gap-1 bg-secondary/50 p-1 rounded-xl">
            {datePresets.map((item) => <button key={item.key} onClick={() => setPresetRange(item.key)} className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-all", preset === item.key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>{item.label}</button>)}
          </div>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPreset("custom"); }} className="px-3 py-2 rounded-lg bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <span className="text-xs text-muted-foreground">t/m</span>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPreset("custom"); }} className="px-3 py-2 rounded-lg bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <div className="flex gap-1 bg-secondary/50 p-1 rounded-xl">
            {(["live", "demo"] as DataMode[]).map((mode) => <button key={mode} onClick={() => setDataMode(mode)} className={cn("px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all", dataMode === mode ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>{mode}</button>)}
          </div>
        </div>

        <div className="flex gap-1 bg-secondary/50 p-1 rounded-xl overflow-x-auto">
          {reportTabs.map((tab) => <button key={tab.key} onClick={() => setReportType(tab.key)} className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap", reportType === tab.key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>{tab.label}</button>)}
        </div>

        {loading ? <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {stats.map((s) => <div key={s.label} className="stat-card"><div className="flex items-center justify-between"><s.icon className="w-4 h-4 text-primary" /><span className={cn("text-xs font-medium px-2 py-0.5 rounded-md", typeof s.trendValue === "number" ? trendClass(s.trendValue) : "text-muted-foreground bg-secondary/50")}>{s.trend}</span></div><p className="text-2xl font-bold mt-3 leading-none">{s.value}</p><p className="text-xs text-muted-foreground mt-2">{s.label}</p></div>)}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="glass-card p-5"><div className="flex items-center gap-2 mb-3"><Target className="w-4 h-4 text-primary" /><h3 className="text-sm font-semibold">Maanddoel</h3></div><p className="text-2xl font-bold">{report.wow.monthlyGoalProgress}%</p><div className="w-full h-2 rounded-full bg-secondary mt-3 overflow-hidden"><div className="h-2 rounded-full bg-primary" style={{ width: `${report.wow.monthlyGoalProgress}%` }} /></div><p className="text-xs text-muted-foreground mt-2">{eur(report.revenue.month)} van {eur(report.wow.monthlyGoal)}</p></div>
          <div className="glass-card p-5"><p className="text-xs text-muted-foreground mb-2">Beste dag ooit omzet</p><p className="text-xl font-bold">{eur(report.wow.bestDayEver.revenue)}</p><p className="text-xs text-muted-foreground mt-1 capitalize">{report.wow.bestDayEver.label}</p></div>
          <div className="glass-card p-5"><p className="text-xs text-muted-foreground mb-2">Verwachte omzet 7 dagen</p><p className="text-xl font-bold">{eur(report.wow.upcoming7Revenue)}</p><p className="text-xs text-muted-foreground mt-1">Geboekte niet-geannuleerde afspraken</p></div>
        </div>

        {reportType === "omzet" && <MetricGrid items={[["Vandaag", eur(report.revenue.today)], ["Deze week", eur(report.revenue.week)], ["Deze maand", eur(report.revenue.month)], ["Lifetime", eur(report.revenue.lifetime)], ["Gem. orderwaarde", eur(report.revenue.averageOrder)], ["Openstaand", eur(report.revenue.openAmount)], ["Refunds", eur(report.revenue.refundTotal)], ["Beste klant maand", report.wow.bestCustomerThisMonth?.name || "—"]]} />}
        {reportType === "afspraken" && <MetricGrid items={[["Vandaag", String(report.appointments.today)], ["Komend", String(report.appointments.upcoming)], ["Afgerond", String(report.appointments.completed)], ["Geannuleerd", String(report.appointments.canceled)], ["No-show", `${report.appointments.noShowPct}%`], ["Gem. afspraakwaarde", eur(report.appointments.averageValue)], ["Populairst", report.appointments.mostPopularService], ["Drukste tijd", report.appointments.busiestTime]]} />}
        {reportType === "klanten" && <CustomerList report={report} />}
        {reportType === "betalingen" && <PaymentList report={report} customers={customers} />}
        {reportType === "btw" && <MetricGrid items={[["Omzet incl. BTW", eur(report.revenue.period)], ["Omzet excl. BTW", eur(report.revenue.period / 1.21)], ["BTW 21%", eur(report.revenue.period * 0.21 / 1.21)], ["Betaalde transacties", String(report.rows.periodPayments.length)]]} />}
        {reportType === "producten" && <ProductList products={products} />}
        {reportType === "diensten" && <ServiceList services={report.services} />}
        {reportType === "export" && <ExportCenter canExport={can("reports:export")} onExport={handleExport} />}
      </div>
    </AppLayout>
  );
}

function MetricGrid({ items }: { items: string[][] }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{items.map(([label, value]) => <div key={label} className="glass-card p-5"><p className="text-xs text-muted-foreground mb-2">{label}</p><p className="text-xl font-bold break-words">{value}</p></div>)}</div>;
}

function CustomerList({ report }: { report: ReturnType<typeof buildReports> }) {
  return <div className="glass-card p-6"><h3 className="text-sm font-semibold mb-5">Top 10 klanten op omzet</h3><div className="space-y-3">{report.customers.top10.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">Nog geen klantomzet</p> : report.customers.top10.map((c, i) => <div key={c.id} className="flex items-center gap-4 p-3 rounded-xl bg-secondary/20"><span className="text-sm font-bold text-muted-foreground w-6 text-center">#{i + 1}</span><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{c.name}</p><p className="text-xs text-muted-foreground mt-0.5">{c.visits} bezoeken · LTV {eur(c.ltv)}</p></div><span className="text-sm font-semibold flex-shrink-0">{eur(c.revenue)}</span></div>)}</div><div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5"><div className="p-3 rounded-xl bg-secondary/20"><p className="text-xs text-muted-foreground">Terugkerend</p><p className="font-bold">{report.customers.returningPct}%</p></div><div className="p-3 rounded-xl bg-secondary/20"><p className="text-xs text-muted-foreground">60+ dagen niet geweest</p><p className="font-bold">{report.customers.inactive60.length}</p></div><div className="p-3 rounded-xl bg-secondary/20"><p className="text-xs text-muted-foreground">Gem. bezoekfrequentie</p><p className="font-bold">{report.customers.averageVisitFrequency.toFixed(1)}x</p></div></div></div>;
}

function PaymentList({ report, customers }: { report: ReturnType<typeof buildReports>; customers: { id: string; name: string }[] }) {
  return <div className="glass-card p-6"><h3 className="text-sm font-semibold mb-5">Betaalde transacties</h3><div className="space-y-3">{report.rows.periodPayments.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">Geen betaalde transacties</p> : report.rows.periodPayments.slice(0, 12).map((p) => <div key={p.id} className="flex items-center justify-between gap-3 p-4 rounded-xl bg-secondary/30"><div className="min-w-0"><p className="text-sm font-medium truncate">{customers.find((c) => c.id === p.customer_id)?.name || "Onbekend"}</p><p className="text-xs text-muted-foreground mt-0.5">{new Date(p.created_at).toLocaleDateString("nl-NL")} · {p.mollie_method || p.method || "—"}</p></div><div className="text-right flex-shrink-0"><p className="text-sm font-semibold">{eur(Number(p.amount))}</p><span className="text-[11px] font-medium text-success">paid</span></div></div>)}</div></div>;
}

function ProductList({ products }: { products: { id: string; name: string; category: string | null; price: number; stock: number | null }[] }) {
  return <div className="glass-card p-6"><h3 className="text-sm font-semibold mb-5">Productoverzicht</h3><div className="space-y-3">{products.map((p) => <div key={p.id} className="flex items-center justify-between gap-3 p-4 rounded-xl bg-secondary/30"><div className="min-w-0"><p className="text-sm font-medium truncate">{p.name}</p><p className="text-xs text-muted-foreground mt-0.5">{p.category || "—"}</p></div><div className="text-right flex-shrink-0"><p className="text-sm font-semibold">{eur(p.price)}</p><span className={cn("text-[11px]", (p.stock || 0) < 5 ? "text-destructive font-medium" : "text-muted-foreground")}>Voorraad: {p.stock || 0}</span></div></div>)}</div></div>;
}

function ServiceList({ services }: { services: { name: string; bookings: number; revenue: number }[] }) {
  return <div className="glass-card p-6"><h3 className="text-sm font-semibold mb-5">Omzet per dienst</h3><div className="space-y-3">{services.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">Nog geen data</p> : services.map((s, i) => <div key={s.name} className="flex items-center gap-4 p-3 rounded-xl bg-secondary/20"><span className="text-sm font-bold text-muted-foreground w-6 text-center">#{i + 1}</span><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{s.name}</p><p className="text-xs text-muted-foreground mt-0.5">{s.bookings} boekingen</p></div><span className="text-sm font-semibold flex-shrink-0">{eur(s.revenue)}</span></div>)}</div></div>;
}
