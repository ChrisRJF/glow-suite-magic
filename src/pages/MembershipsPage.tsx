import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { memberships, formatEuro, customers } from "@/lib/data";
import { Check, Crown, Users, TrendingUp, Euro } from "lucide-react";
import { cn } from "@/lib/utils";

const memberStats = [
  { label: 'Actieve Leden', value: '23', icon: Users },
  { label: 'Maandomzet Abonnementen', value: '€1.587', icon: Euro },
  { label: 'Retentie', value: '94%', icon: TrendingUp },
];

export default function MembershipsPage() {
  return (
    <AppLayout title="Abonnementen" subtitle="Loyaliteitsprogramma en terugkerende omzet.">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {memberStats.map((stat, i) => (
          <div
            key={stat.label}
            className="stat-card opacity-0 animate-fade-in-up"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center mb-3">
              <stat.icon className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold tracking-tight tabular-nums">{stat.value}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Membership Plans */}
      <h2 className="text-lg font-semibold mb-4 opacity-0 animate-fade-in-up" style={{ animationDelay: '250ms' }}>Abonnement Pakketten</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {memberships.map((plan, i) => (
          <div
            key={plan.id}
            className={cn(
              "glass-card p-6 relative opacity-0 animate-fade-in-up transition-all duration-200 hover:border-primary/30",
              plan.popular && 'border-primary/30 shadow-[0_0_30px_-8px_hsl(var(--glow-purple)/0.2)]'
            )}
            style={{ animationDelay: `${i * 100 + 300}ms` }}
          >
            {plan.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full gradient-bg text-[11px] font-semibold text-primary-foreground flex items-center gap-1">
                <Crown className="w-3 h-3" /> Populair
              </div>
            )}
            <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
            <div className="flex items-baseline gap-1 mb-5">
              <span className="text-3xl font-bold tabular-nums">{formatEuro(plan.price)}</span>
              <span className="text-sm text-muted-foreground">/maand</span>
            </div>
            <ul className="space-y-2.5 mb-6">
              {plan.perks.map((perk, pi) => (
                <li key={pi} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <span>{perk}</span>
                </li>
              ))}
            </ul>
            <Button variant={plan.popular ? 'gradient' : 'outline'} className="w-full">
              Selecteren
            </Button>
          </div>
        ))}
      </div>

      {/* Recent Members */}
      <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '600ms' }}>
        <h2 className="text-lg font-semibold mb-4">Recente Leden</h2>
        <div className="space-y-2">
          {customers.slice(0, 4).map((c) => (
            <div key={c.id} className="flex items-center gap-4 p-3 rounded-xl bg-secondary/50">
              <div className="w-9 h-9 rounded-full gradient-bg flex items-center justify-center">
                <span className="text-xs font-semibold text-primary-foreground">{c.initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">Premium · {c.totalVisits} bezoeken</p>
              </div>
              <p className="text-sm font-semibold tabular-nums">{formatEuro(69)}/mnd</p>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
