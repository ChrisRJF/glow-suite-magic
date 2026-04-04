import { AppLayout } from "@/components/AppLayout";
import { formatEuro } from "@/lib/data";
import { BarChart3, Users, TrendingUp, Clock } from "lucide-react";

const stats = [
  { label: "Totale omzet (maand)", value: formatEuro(16800), icon: BarChart3, trend: "+12%" },
  { label: "Gemiddeld per klant", value: formatEuro(67.20), icon: Users, trend: "+5%" },
  { label: "Bezettingsgraad", value: "74%", icon: Clock, trend: "+8%" },
  { label: "Nieuwe klanten", value: "23", icon: TrendingUp, trend: "+15%" },
];

const monthlyData = [
  { month: "Jan", revenue: 14200 },
  { month: "Feb", revenue: 13800 },
  { month: "Mrt", revenue: 15600 },
  { month: "Apr", revenue: 16800 },
];

const topServices = [
  { name: "Knippen & Kleuren", revenue: 4200, bookings: 48 },
  { name: "Gezichtsbehandeling", revenue: 2600, bookings: 32 },
  { name: "Manicure Deluxe", revenue: 1800, bookings: 45 },
  { name: "Wenkbrauwen", revenue: 1200, bookings: 60 },
];

export default function RapportenPage() {
  const maxRevenue = Math.max(...monthlyData.map((m) => m.revenue));

  return (
    <AppLayout title="Rapporten" subtitle="Statistieken en inzichten">
      <div className="grid gap-6">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="stat-card">
              <div className="flex items-center justify-between">
                <s.icon className="w-4 h-4 text-primary" />
                <span className="text-xs text-emerald-400 font-medium">{s.trend}</span>
              </div>
              <p className="text-2xl font-bold mt-2">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Monthly chart */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4">Maandelijkse omzet</h3>
          <div className="flex items-end gap-4 h-32">
            {monthlyData.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-muted-foreground">{formatEuro(m.revenue)}</span>
                <div
                  className="w-full rounded-t-lg bg-gradient-to-t from-primary/80 to-accent/60 transition-all"
                  style={{ height: `${(m.revenue / maxRevenue) * 100}%` }}
                />
                <span className="text-xs text-muted-foreground">{m.month}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top services */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4">Top behandelingen</h3>
          <div className="space-y-3">
            {topServices.map((s, i) => (
              <div key={s.name} className="flex items-center gap-4">
                <span className="text-sm font-bold text-muted-foreground w-6">#{i + 1}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.bookings} boekingen</p>
                </div>
                <span className="text-sm font-semibold">{formatEuro(s.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
