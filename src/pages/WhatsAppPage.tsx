import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { MessageCircle, Send, Clock, Users, Sparkles, Zap } from "lucide-react";

const campaigns = [
  { id: '1', title: 'Herinnering morgen', recipients: 6, status: 'gepland', time: '18:00 vandaag', message: 'Hoi {naam}! Vergeet niet je afspraak morgen om {tijd}. Tot dan! 💇‍♀️' },
  { id: '2', title: 'Lege plekken vullen', recipients: 24, status: 'concept', time: '', message: 'Hey {naam}! We hebben deze week nog plekken vrij. Boek nu met 15% korting! 🎉' },
  { id: '3', title: 'Inactieve klanten', recipients: 4, status: 'verzonden', time: 'Gisteren 10:00', message: 'Hoi {naam}, we missen je! Het is al {weken} weken geleden. Boek snel een afspraak 💜' },
];

const automations = [
  { icon: Clock, title: 'Afspraakherinnering', description: 'Automatisch 24 uur van tevoren', active: true },
  { icon: Sparkles, title: 'Na-afspraak bedankje', description: 'Automatisch na elke behandeling', active: true },
  { icon: Users, title: 'Heractivering', description: 'Na 4 weken zonder bezoek', active: false },
  { icon: Zap, title: 'Verjaardagskorting', description: 'Automatisch op de verjaardag', active: false },
];

export default function WhatsAppPage() {
  return (
    <AppLayout title="WhatsApp" subtitle="Automatische berichten en campagnes.">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Campaigns */}
        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold">Campagnes</h2>
            <Button variant="gradient" size="sm">
              <Send className="w-4 h-4" /> Nieuwe Campagne
            </Button>
          </div>
          <div className="space-y-3">
            {campaigns.map((c) => (
              <div key={c.id} className="p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors duration-200">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold">{c.title}</h3>
                  <span className={`px-2.5 py-1 rounded-lg text-[11px] font-medium ${
                    c.status === 'verzonden' ? 'bg-success/15 text-success' :
                    c.status === 'gepland' ? 'bg-primary/15 text-primary' :
                    'bg-warning/15 text-warning'
                  }`}>
                    {c.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-2 leading-relaxed">{c.message}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Users className="w-3 h-3" />{c.recipients} ontvangers</span>
                  {c.time && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{c.time}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Automations */}
        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          <div className="flex items-center gap-2 mb-5">
            <MessageCircle className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Automatiseringen</h2>
          </div>
          <div className="space-y-3">
            {automations.map((a, i) => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-secondary/50">
                <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
                  <a.icon className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{a.description}</p>
                </div>
                <button
                  className={`w-11 h-6 rounded-full transition-colors duration-200 relative ${
                    a.active ? 'bg-primary' : 'bg-secondary'
                  }`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                    a.active ? 'translate-x-[22px]' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            ))}
          </div>

          {/* AI Message Generator */}
          <div className="mt-6 p-4 rounded-xl border border-primary/20 bg-primary/5">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">AI Berichtgenerator</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3">Laat AI een persoonlijk bericht schrijven voor je campagne.</p>
            <Button variant="outline" size="sm" className="w-full">
              Bericht Genereren
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
