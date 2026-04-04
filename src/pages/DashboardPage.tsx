import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { todaysAppointments, aiSuggestions, formatEuro } from "@/lib/data";
import {
  TrendingUp, Users, Calendar, Euro, Sparkles, ArrowRight, Clock,
  MessageCircle, Zap, BarChart3, RefreshCw, Tag, Target,
  Send, AlertTriangle, Star, UserX, Plus, Megaphone, CalendarPlus
} from "lucide-react";

const stats = [
  { label: "Omzet Vandaag", value: "€1.087", change: "+18%", icon: Euro, positive: true, helper: "Verdien meer door lege plekken te vullen" },
  { label: "Gem. Besteding / Klant", value: "€93", change: "+8%", icon: TrendingUp, positive: true, helper: "Meer herboekingen = meer omzet" },
  { label: "Bezettingsgraad", value: "72%", change: "+5%", icon: BarChart3, positive: true, helper: "Automatiseer je marketing in 1 klik" },
  { label: "Verwachte Omzet Week", value: "€4.320", change: "+12%", icon: Target, positive: true, helper: "Op basis van huidige agenda" },
];

const revenueOpportunities = [
  { text: "5 lege plekken morgen = ± €300 gemist", icon: "📉", urgent: true },
  { text: "Top stylist niet volledig ingepland", icon: "✂️", urgent: false },
  { text: "3 klanten met verlopen abonnement", icon: "🔄", urgent: false },
];

const customerSegments = [
  { label: "VIP Klanten", count: 42, icon: Star, color: "text-warning" },
  { label: "Inactief (30+ dagen)", count: 18, icon: UserX, color: "text-destructive" },
  { label: "No-show Risico", count: 7, icon: AlertTriangle, color: "text-warning" },
];

export default function DashboardPage() {
  return (
    <AppLayout title="Overzicht" subtitle="Zaterdag 21 maart — Hier is je dag in één oogopslag.">
      {/* Quick Action Bar */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1 opacity-0 animate-fade-in-up">
        <Button variant="gradient" size="sm" className="flex-shrink-0">
          <Plus className="w-3.5 h-3.5" /> Nieuwe afspraak
        </Button>
        <Button variant="outline" size="sm" className="flex-shrink-0">
          <Megaphone className="w-3.5 h-3.5" /> Stuur campagne
        </Button>
        <Button variant="outline" size="sm" className="flex-shrink-0">
          <CalendarPlus className="w-3.5 h-3.5" /> Vul lege plekken
        </Button>
      </div>

      {/* AI Omzet Insights - Top Priority Card */}
      <div className="glass-card p-6 mb-6 opacity-0 animate-fade-in-up border border-primary/20 relative overflow-hidden" style={{ animationDelay: '50ms' }}>
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-accent/5 pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary-foreground" />
            </div>
            <h2 className="text-lg font-semibold">AI Inzichten</h2>
          </div>
          <div className="space-y-2.5 mb-4">
            <p className="text-sm flex items-start gap-2">
              <span className="text-destructive font-semibold">⚡</span>
              <span>Je mist <span className="font-semibold text-destructive">€1.240</span> omzet deze week door lege plekken</span>
            </p>
            <p className="text-sm flex items-start gap-2">
              <span className="text-warning font-semibold">👥</span>
              <span>3 klanten zijn overdue voor een nieuwe afspraak</span>
            </p>
            <p className="text-sm flex items-start gap-2">
              <span className="text-warning font-semibold">📅</span>
              <span>Vrijdagmiddag is <span className="font-semibold">60% leeg</span> → actie nodig</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="gradient" size="sm">
              <MessageCircle className="w-3.5 h-3.5" /> Stuur WhatsApp campagne
            </Button>
            <Button variant="outline" size="sm">
              <CalendarPlus className="w-3.5 h-3.5" /> Vul agenda automatisch
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className="stat-card opacity-0 animate-fade-in-up"
            style={{ animationDelay: `${150 + i * 80}ms` }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
                <stat.icon className="w-5 h-5 text-muted-foreground" />
              </div>
              <span className="text-xs font-medium text-success">{stat.change}</span>
            </div>
            <p className="text-2xl font-bold tracking-tight tabular-nums">{stat.value}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1.5 italic">{stat.helper}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Today's Appointments */}
        <div className="lg:col-span-2 glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '450ms' }}>
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
                <div className="w-1 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: apt.color }} />
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
                <div className={`px-2.5 py-1 rounded-lg text-[11px] font-medium ${
                  apt.status === 'bevestigd' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                }`}>
                  {apt.status}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* AI Suggestions */}
        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '550ms' }}>
          <div className="flex items-center gap-2 mb-5">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">AI Suggesties</h2>
          </div>
          <div className="space-y-3">
            {aiSuggestions.map((suggestion) => (
              <div key={suggestion.id} className="p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors duration-200 group">
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

      {/* Second Row: Revenue Opportunities + Rebooking + Dynamic Pricing */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Gemiste Omzet Kansen */}
        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '600ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-5 h-5 text-destructive" />
            <h2 className="text-base font-semibold">Gemiste Omzet Kansen</h2>
          </div>
          <div className="space-y-3">
            {revenueOpportunities.map((item, i) => (
              <div key={i} className={`p-3 rounded-xl text-sm flex items-start gap-2.5 ${item.urgent ? 'bg-destructive/10 border border-destructive/20' : 'bg-secondary/50'}`}>
                <span className="flex-shrink-0">{item.icon}</span>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground/60 mt-3 italic">Verdien meer door lege plekken te vullen</p>
        </div>

        {/* Auto Rebooking Tracker */}
        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '650ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <RefreshCw className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold">Herboekingen</h2>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="text-muted-foreground">Met volgende afspraak</span>
                <span className="font-semibold text-success">64%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-secondary">
                <div className="h-2 rounded-full bg-success" style={{ width: '64%' }} />
              </div>
            </div>
            <div className="p-3 rounded-xl bg-secondary/50 text-sm">
              <p className="text-muted-foreground">Zonder nieuwe afspraak</p>
              <p className="text-xl font-bold mt-1">127 <span className="text-sm font-normal text-muted-foreground">klanten</span></p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full mt-4">
            <Send className="w-3.5 h-3.5" /> Stuur herboek voorstel
          </Button>
          <p className="text-[11px] text-muted-foreground/60 mt-2 italic text-center">Meer herboekingen = meer omzet</p>
        </div>

        {/* Slimme Kortingen */}
        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '700ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <Tag className="w-5 h-5 text-accent" />
            <h2 className="text-base font-semibold">Slimme Kortingen</h2>
          </div>
          <div className="p-3.5 rounded-xl bg-accent/10 border border-accent/20 mb-4">
            <p className="text-sm font-medium mb-1">💡 Suggestie</p>
            <p className="text-xs text-muted-foreground leading-relaxed">Maandag 14:00–17:00 is rustig → geef 15% korting</p>
          </div>
          <Button variant="gradient" size="sm" className="w-full">
            <Zap className="w-3.5 h-3.5" /> Activeer automatische korting
          </Button>
        </div>
      </div>

      {/* Third Row: WhatsApp Quick Actions + Klant Segmentatie */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* WhatsApp Quick Actions */}
        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '750ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <MessageCircle className="w-5 h-5 text-success" />
            <h2 className="text-base font-semibold">WhatsApp Acties</h2>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            <Button variant="outline" size="sm"><Send className="w-3.5 h-3.5" /> Stuur herinnering</Button>
            <Button variant="outline" size="sm"><Zap className="w-3.5 h-3.5" /> Last-minute deal</Button>
            <Button variant="outline" size="sm"><RefreshCw className="w-3.5 h-3.5" /> Heractiveer klanten</Button>
          </div>
          <div className="p-3.5 rounded-xl bg-secondary/50 border border-border">
            <p className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">Voorbeeld bericht</p>
            <p className="text-sm leading-relaxed">"Hi Lisa 👋 je bent al 5 weken niet geweest, zin in een afspraak deze week?"</p>
          </div>
          <p className="text-[11px] text-muted-foreground/60 mt-3 italic">Automatiseer je marketing in 1 klik</p>
        </div>

        {/* Klant Segmentatie */}
        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '800ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold">Klant Segmentatie</h2>
          </div>
          <div className="space-y-3 mb-4">
            {customerSegments.map((seg, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-secondary/50">
                <div className="flex items-center gap-2.5">
                  <seg.icon className={`w-4 h-4 ${seg.color}`} />
                  <span className="text-sm">{seg.label}</span>
                </div>
                <span className="text-sm font-semibold tabular-nums">{seg.count}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm"><Star className="w-3.5 h-3.5" /> Campagne naar VIP</Button>
            <Button variant="outline" size="sm"><UserX className="w-3.5 h-3.5" /> Heractiveer inactief</Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
