import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useAppointments, useServices, useProducts, useCustomers } from "@/hooks/useSupabaseData";
import { formatEuro } from "@/lib/data";
import { BarChart3, Users, TrendingUp, Clock } from "lucide-react";
import { useMemo } from "react";

export default function RapportenPage() {
  const { data: appointments } = useAppointments();
  const { data: services } = useServices();
  const { data: products } = useProducts();
  const { data: customers } = useCustomers();

  const totalRevenue = appointments.filter(a => a.status !== 'geannuleerd').reduce((s, a) => s + (Number(a.price) || 0), 0);
  const avgPerCustomer = customers.length > 0 ? totalRevenue / customers.length : 0;
  const bezetting = appointments.length > 0 ? Math.min(100, Math.round(appointments.filter(a => a.status !== 'geannuleerd').length / Math.max(appointments.length, 1) * 100)) : 0;

  const stats = [
    { label: "Totale omzet", value: formatEuro(totalRevenue), icon: BarChart3, trend: `${appointments.length} afspr.` },
    { label: "Gemiddeld per klant", value: formatEuro(avgPerCustomer), icon: Users, trend: `${customers.length} klanten` },
    { label: "Bezettingsgraad", value: `${bezetting}%`, icon: Clock, trend: "actief" },
    { label: "Nieuwe klanten", value: `${customers.filter(c => (Date.now() - new Date(c.created_at).getTime()) < 30 * 86400000).length}`, icon: TrendingUp, trend: "deze maand" },
  ];

  const topServices = useMemo(() => {
    const map: Record<string, { name: string; revenue: number; bookings: number }> = {};
    appointments.filter(a => a.status !== 'geannuleerd' && a.service_id).forEach(a => {
      const svc = services.find(s => s.id === a.service_id);
      const name = svc?.name || 'Onbekend';
      if (!map[name]) map[name] = { name, revenue: 0, bookings: 0 };
      map[name].revenue += Number(a.price) || 0;
      map[name].bookings++;
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [appointments, services]);

  const monthlyData = useMemo(() => {
    const months: { month: string; revenue: number }[] = [];
    for (let i = 3; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const rev = appointments.filter(a => a.appointment_date.startsWith(key) && a.status !== 'geannuleerd').reduce((s, a) => s + (Number(a.price) || 0), 0);
      months.push({ month: d.toLocaleDateString('nl-NL', { month: 'short' }), revenue: rev });
    }
    return months;
  }, [appointments]);

  const maxRevenue = Math.max(...monthlyData.map(m => m.revenue), 1);

  return (
    <AppLayout title="Rapporten" subtitle="Statistieken en inzichten">
      <div className="grid gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="stat-card">
              <div className="flex items-center justify-between"><s.icon className="w-4 h-4 text-primary" /><span className="text-xs text-success font-medium">{s.trend}</span></div>
              <p className="text-2xl font-bold mt-2">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>

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
      </div>
    </AppLayout>
  );
}
