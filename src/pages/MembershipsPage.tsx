import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { memberships, formatEuro } from "@/lib/data";
import { useCustomers, useAppointments } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { Check, Crown, Users, TrendingUp, Euro, Star, Award, Gift } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { toast } from "sonner";

export default function MembershipsPage() {
  const { data: customers, refetch } = useCustomers();
  const { data: appointments } = useAppointments();
  const { update } = useCrud("customers");

  const loyaltyData = useMemo(() => {
    return customers.map(c => {
      const custAppts = appointments.filter(a => a.customer_id === c.id && a.status !== 'geannuleerd');
      const points = (Number(c.loyalty_points) || 0) + custAppts.length * 10;
      const spent = Number(c.total_spent) || 0;
      const isVip = c.is_vip || spent > 500;
      const almostVip = spent >= 350 && spent < 500;
      const tier = isVip ? "VIP" : spent >= 250 ? "Gold" : spent >= 100 ? "Silver" : "Bronze";
      return { ...c, points, isVip, almostVip, tier, visits: custAppts.length, spent };
    }).sort((a, b) => b.spent - a.spent);
  }, [customers, appointments]);

  const vipCount = loyaltyData.filter(c => c.isVip).length;
  const almostVipCount = loyaltyData.filter(c => c.almostVip).length;
  const avgPoints = loyaltyData.length > 0 ? Math.round(loyaltyData.reduce((s, c) => s + c.points, 0) / loyaltyData.length) : 0;

  const handleMarkVip = async (id: string) => {
    const result = await update(id, { is_vip: true } as any);
    if (result) { toast.success("Klant gemarkeerd als VIP ⭐"); refetch(); }
  };

  const memberStats = [
    { label: 'VIP Klanten', value: String(vipCount), icon: Star },
    { label: 'Bijna VIP', value: String(almostVipCount), icon: TrendingUp },
    { label: 'Gem. Punten', value: String(avgPoints), icon: Award },
  ];

  const tierColor = (tier: string) => {
    switch (tier) {
      case "VIP": return "bg-warning/15 text-warning";
      case "Gold": return "bg-yellow-500/15 text-yellow-600";
      case "Silver": return "bg-muted text-muted-foreground";
      default: return "bg-orange-500/15 text-orange-600";
    }
  };

  return (
    <AppLayout title="Loyaliteit & Abonnementen" subtitle="Beloon trouwe klanten en verhoog retentie.">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {memberStats.map((stat, i) => (
          <div key={stat.label} className="stat-card opacity-0 animate-fade-in-up" style={{ animationDelay: `${i * 80}ms` }}>
            <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center mb-3">
              <stat.icon className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold tracking-tight tabular-nums">{stat.value}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Loyalty Tiers */}
      <h2 className="text-lg font-semibold mb-4 opacity-0 animate-fade-in-up" style={{ animationDelay: '250ms' }}>Loyaliteit Ranglijst</h2>
      <div className="glass-card p-6 mb-8 opacity-0 animate-fade-in-up" style={{ animationDelay: '300ms' }}>
        <div className="space-y-2">
          {loyaltyData.slice(0, 10).map((c, i) => (
            <div key={c.id} className="flex items-center gap-4 p-3 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors">
              <div className="w-8 text-center text-sm font-bold text-muted-foreground">#{i + 1}</div>
              <div className="w-9 h-9 rounded-full gradient-bg flex items-center justify-center">
                <span className="text-xs font-semibold text-primary-foreground">
                  {c.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{c.name}</p>
                  <span className={cn("px-1.5 py-0.5 rounded-md text-[10px] font-semibold", tierColor(c.tier))}>{c.tier}</span>
                  {c.isVip && <Star className="w-3.5 h-3.5 text-warning" />}
                </div>
                <p className="text-xs text-muted-foreground">{c.visits} bezoeken · {c.points} punten</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-semibold tabular-nums">{formatEuro(c.spent)}</p>
                {c.almostVip && !c.isVip && (
                  <Button variant="outline" size="sm" className="mt-1 h-6 text-[10px]" onClick={() => handleMarkVip(c.id)}>
                    <Star className="w-3 h-3" /> Maak VIP
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        {loyaltyData.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Nog geen klantdata</p>}
      </div>

      {/* Reward tiers explanation */}
      <h2 className="text-lg font-semibold mb-4 opacity-0 animate-fade-in-up" style={{ animationDelay: '350ms' }}>Beloningsniveaus</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { tier: "Bronze", min: "€0", perk: "10 punten/bezoek", color: "border-orange-500/30" },
          { tier: "Silver", min: "€100+", perk: "5% korting", color: "border-muted" },
          { tier: "Gold", min: "€250+", perk: "10% korting", color: "border-yellow-500/30" },
          { tier: "VIP", min: "€500+", perk: "15% + exclusief", color: "border-warning/30" },
        ].map((t, i) => (
          <div key={t.tier} className={cn("glass-card p-4 border-2 opacity-0 animate-fade-in-up", t.color)} style={{ animationDelay: `${400 + i * 80}ms` }}>
            <p className="text-base font-bold mb-1">{t.tier}</p>
            <p className="text-xs text-muted-foreground mb-2">Vanaf {t.min}</p>
            <p className="text-sm flex items-center gap-1"><Gift className="w-3.5 h-3.5 text-primary" /> {t.perk}</p>
          </div>
        ))}
      </div>

      {/* Membership Plans */}
      <h2 className="text-lg font-semibold mb-4 opacity-0 animate-fade-in-up" style={{ animationDelay: '700ms' }}>Abonnement Pakketten</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {memberships.map((plan, i) => (
          <div key={plan.id} className={cn(
            "glass-card p-6 relative opacity-0 animate-fade-in-up transition-all duration-200 hover:border-primary/30",
            plan.popular && 'border-primary/30 shadow-[0_0_30px_-8px_hsl(var(--glow-purple)/0.2)]'
          )} style={{ animationDelay: `${i * 100 + 800}ms` }}>
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
    </AppLayout>
  );
}