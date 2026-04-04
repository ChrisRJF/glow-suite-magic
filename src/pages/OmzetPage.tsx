import { AppLayout } from "@/components/AppLayout";
import { formatEuro } from "@/lib/data";
import { TrendingUp, TrendingDown, AlertTriangle, ArrowUpRight, Calendar } from "lucide-react";
import { useState } from "react";

const dailyRevenue = [
  { day: "Ma", amount: 480, target: 600 },
  { day: "Di", amount: 720, target: 600 },
  { day: "Wo", amount: 350, target: 600 },
  { day: "Do", amount: 610, target: 600 },
  { day: "Vr", amount: 890, target: 700 },
  { day: "Za", amount: 1100, target: 900 },
];

const missedRevenue = [
  { reason: "Lege plekken maandag", amount: 240 },
  { reason: "No-shows deze week", amount: 180 },
  { reason: "Niet-geboekte upsells", amount: 320 },
];

const predictions = [
  { label: "Verwachte omzet deze week", value: 4150 },
  { label: "Verwachte omzet deze maand", value: 16800 },
  { label: "Groei t.o.v. vorige maand", value: 12, isPercent: true },
];

export default function OmzetPage() {
  const [period, setPeriod] = useState<"week" | "maand">("week");
  const totalRevenue = dailyRevenue.reduce((s, d) => s + d.amount, 0);
  const totalTarget = dailyRevenue.reduce((s, d) => s + d.target, 0);
  const totalMissed = missedRevenue.reduce((s, d) => s + d.amount, 0);

  return (
    <AppLayout title="Omzet" subtitle="Inzicht in je omzet en groeikansen">
      <div className="grid gap-6">
        {/* Period toggle */}
        <div className="flex gap-2">
          {(["week", "maand"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                period === p
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {p === "week" ? "Deze week" : "Deze maand"}
            </button>
          ))}
        </div>

        {/* Top stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {predictions.map((p) => (
            <div key={p.label} className="stat-card">
              <p className="text-xs text-muted-foreground">{p.label}</p>
              <p className="text-2xl font-bold mt-1">
                {p.isPercent ? `+${p.value}%` : formatEuro(p.value)}
              </p>
              <div className="flex items-center gap-1 mt-1 text-xs text-emerald-400">
                <TrendingUp className="w-3 h-3" />
                <span>Stijgend</span>
              </div>
            </div>
          ))}
        </div>

        {/* Revenue chart (bar-like visual) */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4">Omzet per dag</h3>
          <div className="flex items-end gap-3 h-40">
            {dailyRevenue.map((d) => {
              const maxAmount = Math.max(...dailyRevenue.map((x) => Math.max(x.amount, x.target)));
              const height = (d.amount / maxAmount) * 100;
              const targetH = (d.target / maxAmount) * 100;
              const aboveTarget = d.amount >= d.target;
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">{formatEuro(d.amount)}</span>
                  <div className="w-full relative" style={{ height: "100%" }}>
                    <div
                      className={`absolute bottom-0 w-full rounded-t-lg transition-all ${
                        aboveTarget
                          ? "bg-gradient-to-t from-primary/80 to-accent/60"
                          : "bg-destructive/40"
                      }`}
                      style={{ height: `${height}%` }}
                    />
                    <div
                      className="absolute bottom-0 w-full border-t-2 border-dashed border-muted-foreground/30"
                      style={{ bottom: `${targetH}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">{d.day}</span>
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-primary/80" /> Omzet
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 border-t-2 border-dashed border-muted-foreground/40" style={{ width: 12 }} /> Target
            </div>
          </div>
        </div>

        {/* Missed revenue */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <h3 className="text-sm font-semibold">Gemiste omzet: {formatEuro(totalMissed)}</h3>
          </div>
          <div className="space-y-3">
            {missedRevenue.map((m) => (
              <div key={m.reason} className="flex items-center justify-between py-2 border-b border-border last:border-0">
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
