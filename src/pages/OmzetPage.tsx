import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useAppointments, useCustomers, useServices } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { formatEuro } from "@/lib/data";
import { TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { useState, useMemo } from "react";

export default function OmzetPage() {
  const { data: appointments } = useAppointments();
  const { data: services } = useServices();
  const [period, setPeriod] = useState<"week" | "maand">("week");

  const now = new Date();
  const dayNames = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'];

  const dailyRevenue = useMemo(() => {
    const days: { day: string; amount: number; target: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const dayAppts = appointments.filter(a => a.appointment_date.startsWith(ds) && a.status !== 'geannuleerd');
      const amount = dayAppts.reduce((s, a) => s + (Number(a.price) || 0), 0);
      days.push({ day: dayNames[d.getDay()], amount, target: 600 });
    }
    return days;
  }, [appointments]);

  const totalRevenue = dailyRevenue.reduce((s, d) => s + d.amount, 0);
  const totalMissed = dailyRevenue.reduce((s, d) => s + Math.max(0, d.target - d.amount), 0);
  const maxAmount = Math.max(...dailyRevenue.map(d => Math.max(d.amount, d.target)), 1);

  const predictions = [
    { label: "Verwachte omzet deze week", value: totalRevenue },
    { label: "Verwachte omzet deze maand", value: totalRevenue * 4 },
    { label: "Groei t.o.v. vorige maand", value: 12, isPercent: true },
  ];

  const missedRevenue = [
    { reason: "Lege plekken", amount: totalMissed },
    { reason: "Geannuleerde afspraken", amount: appointments.filter(a => a.status === 'geannuleerd').reduce((s, a) => s + (Number(a.price) || 0), 0) },
  ];

  return (
    <AppLayout title="Omzet" subtitle="Inzicht in je omzet en groeikansen">
      <div className="grid gap-8">
        <div className="flex gap-2">
          {(["week", "maand"] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${period === p ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
              {p === "week" ? "Deze week" : "Deze maand"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {predictions.map((p) => (
            <div key={p.label} className="stat-card">
              <p className="text-xs text-muted-foreground">{p.label}</p>
              <p className="text-2xl font-bold mt-3 leading-none">{p.isPercent ? `+${p.value}%` : formatEuro(p.value)}</p>
              <div className="flex items-center gap-1.5 mt-3 text-xs text-success"><TrendingUp className="w-3 h-3" /><span>Stijgend</span></div>
            </div>
          ))}
        </div>

        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-5">Omzet per dag</h3>
          <div className="flex items-end gap-3 h-44 pt-2">
            {dailyRevenue.map((d) => {
              const height = (d.amount / maxAmount) * 100;
              const targetH = (d.target / maxAmount) * 100;
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
                  <span className="text-[10px] text-muted-foreground font-medium">{formatEuro(d.amount)}</span>
                  <div className="w-full relative flex-1">
                    <div className={`absolute bottom-0 w-full rounded-t-lg transition-all ${d.amount >= d.target ? "bg-gradient-to-t from-primary/80 to-accent/60" : "bg-destructive/40"}`}
                      style={{ height: `${height}%` }} />
                    <div className="absolute w-full border-t-2 border-dashed border-muted-foreground/30" style={{ bottom: `${targetH}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground">{d.day}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-5">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <h3 className="text-sm font-semibold">Gemiste omzet: {formatEuro(missedRevenue.reduce((s, m) => s + m.amount, 0))}</h3>
          </div>
          <div className="space-y-1">
            {missedRevenue.map((m) => (
              <div key={m.reason} className="flex items-center justify-between py-3 border-b border-border/60 last:border-0">
                <span className="text-sm text-muted-foreground">{m.reason}</span>
                <span className="text-sm font-semibold text-destructive">{formatEuro(m.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
