import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useAppointments, useServices, useProducts, useCustomers } from "@/hooks/useSupabaseData";
import { usePayments } from "@/hooks/usePayments";
import { formatEuro } from "@/lib/data";
import { exportCSV, exportExcel, exportPDF } from "@/lib/exportUtils";
import { BarChart3, Users, TrendingUp, Clock, Download, FileText, FileSpreadsheet, Filter } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ReportType = "omzet" | "diensten" | "producten" | "betalingen" | "btw";

export default function RapportenPage() {
  const { data: appointments } = useAppointments();
  const { data: services } = useServices();
  const { data: products } = useProducts();
  const { data: customers } = useCustomers();
  const { data: payments } = usePayments();

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [searchParams] = useSearchParams();
  const [reportType, setReportType] = useState<ReportType>(() => {
    const t = searchParams.get("type");
    return (t === "omzet" || t === "diensten" || t === "producten" || t === "betalingen" || t === "btw") ? t : "omzet";
  });
  const [showExport, setShowExport] = useState(false);

  const filteredAppts = useMemo(() =>
    appointments.filter(a => {
      const d = a.appointment_date?.split("T")[0];
      return d >= dateFrom && d <= dateTo && a.status !== 'geannuleerd';
    }), [appointments, dateFrom, dateTo]);

  const totalRevenue = filteredAppts.reduce((s, a) => s + (Number(a.price) || 0), 0);
  const avgPerCustomer = customers.length > 0 ? totalRevenue / customers.length : 0;
  const bezetting = filteredAppts.length > 0 ? Math.min(100, Math.round(filteredAppts.length / Math.max(appointments.length, 1) * 100)) : 0;

  const stats = [
    { label: "Totale omzet", value: formatEuro(totalRevenue), icon: BarChart3, trend: `${filteredAppts.length} afspr.` },
    { label: "Gemiddeld per klant", value: formatEuro(avgPerCustomer), icon: Users, trend: `${customers.length} klanten` },
    { label: "Bezettingsgraad", value: `${bezetting}%`, icon: Clock, trend: "actief" },
    { label: "Nieuwe klanten", value: `${customers.filter(c => { const d = c.created_at?.split("T")[0]; return d >= dateFrom && d <= dateTo; }).length}`, icon: TrendingUp, trend: "periode" },
  ];

  const topServices = useMemo(() => {
    const map: Record<string, { name: string; revenue: number; bookings: number }> = {};
    filteredAppts.filter(a => a.service_id).forEach(a => {
      const svc = services.find(s => s.id === a.service_id);
      const name = svc?.name || 'Onbekend';
      if (!map[name]) map[name] = { name, revenue: 0, bookings: 0 };
      map[name].revenue += Number(a.price) || 0;
      map[name].bookings++;
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [filteredAppts, services]);

  const monthlyData = useMemo(() => {
    const months: { month: string; revenue: number }[] = [];
    for (let i = 3; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const rev = appointments.filter(a => a.appointment_date.startsWith(key) && a.status !== 'geannuleerd').reduce((s, a) => s + (Number(a.price) || 0), 0);
      months.push({ month: d.toLocaleDateString('nl-NL', { month: 'short' }), revenue: rev });
    }
    return months;
  }, [appointments]);

  const maxRevenue = Math.max(...monthlyData.map(m => m.revenue), 1);

  const getExportData = (): { title: string; headers: string[]; rows: string[][] } => {
    switch (reportType) {
      case "diensten":
        return {
          title: "Omzet per dienst",
          headers: ["Dienst", "Boekingen", "Omzet"],
          rows: topServices.map(s => [s.name, String(s.bookings), formatEuro(s.revenue)]),
        };
      case "producten":
        return {
          title: "Productverkopen",
          headers: ["Product", "Categorie", "Prijs", "Voorraad"],
          rows: products.map(p => [p.name, p.category || "—", formatEuro(p.price), String(p.stock || 0)]),
        };
      case "betalingen":
        return {
          title: "Betalingen (GlowPay)",
          headers: ["Datum", "Klant", "Bedrag", "Methode", "Status"],
          rows: payments.map(p => [
            new Date(p.created_at).toLocaleDateString("nl-NL"),
            customers.find(c => c.id === p.customer_id)?.name || "Onbekend",
            formatEuro(Number(p.amount)),
            p.method || p.payment_method || "—",
            p.status,
          ]),
        };
      case "btw":
        const btw21 = totalRevenue * 0.21 / 1.21;
        return {
          title: "BTW Overzicht",
          headers: ["Omschrijving", "Bedrag"],
          rows: [
            ["Totale omzet (incl. BTW)", formatEuro(totalRevenue)],
            ["Omzet excl. BTW", formatEuro(totalRevenue - btw21)],
            ["BTW 21%", formatEuro(btw21)],
          ],
        };
      default:
        return {
          title: "Omzet per periode",
          headers: ["Datum", "Klant", "Dienst", "Bedrag"],
          rows: filteredAppts.map(a => [
            new Date(a.appointment_date).toLocaleDateString("nl-NL"),
            customers.find(c => c.id === a.customer_id)?.name || "Onbekend",
            services.find(s => s.id === a.service_id)?.name || "—",
            formatEuro(Number(a.price) || 0),
          ]),
        };
    }
  };

  const handleExport = (format: "csv" | "excel" | "pdf") => {
    const { title, headers, rows } = getExportData();
    const dateStr = new Date().toISOString().split("T")[0];
    switch (format) {
      case "csv": exportCSV(headers, rows, `glowsuite-${reportType}-${dateStr}.csv`); break;
      case "excel": exportExcel(headers, rows, `glowsuite-${reportType}-${dateStr}.xls`); break;
      case "pdf": exportPDF(title, headers, rows, `glowsuite-${reportType}-${dateStr}.pdf`); break;
    }
    toast.success(`${title} geëxporteerd als ${format.toUpperCase()}`);
    setShowExport(false);
  };

  const reportTabs: { key: ReportType; label: string }[] = [
    { key: "omzet", label: "Omzet" },
    { key: "diensten", label: "Diensten" },
    { key: "producten", label: "Producten" },
    { key: "betalingen", label: "Betalingen" },
    { key: "btw", label: "BTW" },
  ];

  return (
    <AppLayout title="Rapporten" subtitle="Statistieken en inzichten"
      actions={
        <div className="relative">
          <Button variant="gradient" size="sm" onClick={() => setShowExport(!showExport)}>
            <Download className="w-4 h-4" /> Exporteer rapport
          </Button>
          {showExport && (
            <div className="absolute right-0 top-full mt-2 w-48 glass-card p-2 z-50 space-y-1">
              <button onClick={() => handleExport("pdf")} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-secondary/50 transition-colors">
                <FileText className="w-4 h-4 text-destructive" /> PDF
              </button>
              <button onClick={() => handleExport("excel")} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-secondary/50 transition-colors">
                <FileSpreadsheet className="w-4 h-4 text-success" /> Excel (.xls)
              </button>
              <button onClick={() => handleExport("csv")} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-secondary/50 transition-colors">
                <FileText className="w-4 h-4 text-primary" /> CSV
              </button>
            </div>
          )}
        </div>
      }>
      <div className="grid gap-6">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <span className="text-xs text-muted-foreground">t/m</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div className="flex gap-1 bg-secondary/50 p-1 rounded-xl">
            {reportTabs.map(tab => (
              <button key={tab.key} onClick={() => setReportType(tab.key)}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  reportType === tab.key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="stat-card">
              <div className="flex items-center justify-between"><s.icon className="w-4 h-4 text-primary" /><span className="text-xs text-success font-medium">{s.trend}</span></div>
              <p className="text-2xl font-bold mt-2">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Monthly Chart */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4">Maandelijkse omzet</h3>
          <div className="flex items-end gap-4 h-32">
            {monthlyData.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-muted-foreground">{formatEuro(m.revenue)}</span>
                <div className="w-full rounded-t-lg bg-gradient-to-t from-primary/80 to-accent/60 transition-all" style={{ height: `${(m.revenue / maxRevenue) * 100}%`, minHeight: '4px' }} />
                <span className="text-xs text-muted-foreground">{m.month}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Report-specific content */}
        {reportType === "omzet" && (
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-4">Top behandelingen</h3>
            <div className="space-y-3">
              {topServices.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">Nog geen data</p> :
              topServices.map((s, i) => (
                <div key={s.name} className="flex items-center gap-4">
                  <span className="text-sm font-bold text-muted-foreground w-6">#{i + 1}</span>
                  <div className="flex-1"><p className="text-sm font-medium">{s.name}</p><p className="text-xs text-muted-foreground">{s.bookings} boekingen</p></div>
                  <span className="text-sm font-semibold">{formatEuro(s.revenue)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {reportType === "betalingen" && (
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-4">Betalingsoverzicht</h3>
            <div className="space-y-2">
              {payments.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">Geen betalingen</p> :
              payments.slice(0, 10).map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/30">
                  <div>
                    <p className="text-sm font-medium">{customers.find(c => c.id === p.customer_id)?.name || "Onbekend"}</p>
                    <p className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString("nl-NL")} · {p.method || "—"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{formatEuro(Number(p.amount))}</p>
                    <span className={cn("text-[11px] font-medium", p.status === "paid" ? "text-success" : p.status === "failed" ? "text-destructive" : "text-warning")}>{p.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {reportType === "btw" && (
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-4">BTW Overzicht</h3>
            <div className="space-y-3">
              <div className="flex justify-between p-3 rounded-xl bg-secondary/30">
                <span className="text-sm">Omzet incl. BTW</span>
                <span className="text-sm font-semibold">{formatEuro(totalRevenue)}</span>
              </div>
              <div className="flex justify-between p-3 rounded-xl bg-secondary/30">
                <span className="text-sm">Omzet excl. BTW</span>
                <span className="text-sm font-semibold">{formatEuro(totalRevenue / 1.21)}</span>
              </div>
              <div className="flex justify-between p-3 rounded-xl bg-primary/10 border border-primary/20">
                <span className="text-sm font-medium">BTW 21%</span>
                <span className="text-sm font-bold text-primary">{formatEuro(totalRevenue * 0.21 / 1.21)}</span>
              </div>
            </div>
          </div>
        )}

        {reportType === "producten" && (
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-4">Productoverzicht</h3>
            <div className="space-y-2">
              {products.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/30">
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.category || "—"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{formatEuro(p.price)}</p>
                    <span className={cn("text-[11px]", (p.stock || 0) < 5 ? "text-destructive font-medium" : "text-muted-foreground")}>
                      Voorraad: {p.stock || 0}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {reportType === "diensten" && (
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-4">Alle diensten</h3>
            <div className="space-y-2">
              {services.map(s => {
                const bookings = filteredAppts.filter(a => a.service_id === s.id).length;
                const rev = filteredAppts.filter(a => a.service_id === s.id).reduce((sum, a) => sum + (Number(a.price) || 0), 0);
                return (
                  <div key={s.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/30">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-8 rounded-full" style={{ backgroundColor: s.color || "#7B61FF" }} />
                      <div>
                        <p className="text-sm font-medium">{s.name}</p>
                        <p className="text-xs text-muted-foreground">{bookings} boekingen</p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold">{formatEuro(rev)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
