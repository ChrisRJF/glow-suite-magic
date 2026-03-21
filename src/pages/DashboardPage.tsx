import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { todaysAppointments, aiSuggestions, formatEuro } from "@/lib/data";
import { TrendingUp, Users, Calendar, Euro, Sparkles, ArrowRight, Clock } from "lucide-react";

const stats = [
  { label: "Omzet Vandaag", value: "€1.087", change: "+18%", icon: Euro, positive: true },
  { label: "Afspraken", value: "6", change: "2 in afwachting", icon: Calendar, positive: true },
  { label: "Klanten", value: "847", change: "+12 deze week", icon: Users, positive: true },
  { label: "Gem. Bon", value: "€93", change: "+8%", icon: TrendingUp, positive: true },
];

export default function DashboardPage() {
  return (
    <AppLayout title="Overzicht" subtitle="Zaterdag 21 maart — Hier is je dag in één oogopslag.">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className={`stat-card opacity-0 animate-fade-in-up`}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
                <stat.icon className="w-5 h-5 text-muted-foreground" />
              </div>
              <span className="text-xs font-medium text-success">{stat.change}</span>
            </div>
            <p className="text-2xl font-bold tracking-tight tabular-nums">{stat.value}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Appointments */}
        <div className="lg:col-span-2 glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '300ms' }}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold">Planning Vandaag</h2>
            <Button variant="ghost" size="sm">
              Alles Bekijken <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
          <div className="space-y-3">
            {todaysAppointments.map((apt) => (
              <div
                key={apt.id}
                className="flex items-center gap-4 p-3.5 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors duration-200 group"
              >
                <div
                  className="w-1 h-10 rounded-full flex-shrink-0"
                  style={{ backgroundColor: apt.color }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{apt.customerName}</p>
                  <p className="text-xs text-muted-foreground">{apt.service}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-medium tabular-nums">{apt.time}</p>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {apt.duration} min
                  </div>
                </div>
                <div
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium ${
                    apt.status === 'bevestigd'
                      ? 'bg-success/15 text-success'
                      : 'bg-warning/15 text-warning'
                  }`}
                >
                  {apt.status}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* AI Suggestions */}
        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '400ms' }}>
          <div className="flex items-center gap-2 mb-5">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">AI Suggesties</h2>
          </div>
          <div className="space-y-3">
            {aiSuggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className="p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors duration-200 group"
              >
                <div className="flex items-start gap-3">
                  <span className="text-lg flex-shrink-0">{suggestion.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium mb-1">{suggestion.title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{suggestion.description}</p>
                    <Button variant="ghost" size="sm" className="mt-2 h-7 px-2.5 text-xs text-primary">
                      {suggestion.action} <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
