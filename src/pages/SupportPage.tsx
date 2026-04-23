import { AppLayout } from "@/components/AppLayout";
import { HelpCircle, MessageCircle, Book, Mail, ExternalLink } from "lucide-react";

const faqs = [
  { q: "Hoe maak ik een nieuwe afspraak?", a: "Ga naar Agenda en klik op '+ Nieuwe Afspraak', of gebruik de Quick Action bar." },
  { q: "Hoe stuur ik een WhatsApp campagne?", a: "Ga naar Marketing of Acties en klik op 'Stuur campagne'." },
  { q: "Hoe activeer ik automatische kortingen?", a: "Ga naar Acties en klik op 'Activeer korting'. Het systeem detecteert automatisch rustige uren." },
  { q: "Hoe bekijk ik mijn omzetrapport?", a: "Ga naar Omzet of Rapporten voor gedetailleerde inzichten." },
];

const resources = [
  { icon: Book, label: "Documentatie", desc: "Binnenkort beschikbaar", url: "", disabled: true },
  { icon: MessageCircle, label: "Live chat", desc: "Binnenkort beschikbaar", url: "", disabled: true },
  { icon: Mail, label: "E-mail support", desc: "support@glowsuite.nl", url: "mailto:support@glowsuite.nl" },
];

export default function SupportPage() {
  return (
    <AppLayout title="Support" subtitle="Hulp en veelgestelde vragen">
      <div className="grid gap-6 max-w-2xl">
        {/* Resources */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {resources.map((r) => r.disabled ? (
            <button key={r.label} type="button" disabled className="glass-card p-5 text-left opacity-70 cursor-not-allowed">
              <r.icon className="w-5 h-5 text-primary mb-2" />
              <p className="text-sm font-semibold flex items-center gap-1">{r.label}</p>
              <p className="text-xs text-muted-foreground mt-1">{r.desc}</p>
            </button>
          ) : (
            <a key={r.label} href={r.url} className="glass-card p-5 hover:border-primary/30 transition-all group">
              <r.icon className="w-5 h-5 text-primary mb-2" />
              <p className="text-sm font-semibold flex items-center gap-1">
                {r.label} <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </p>
              <p className="text-xs text-muted-foreground mt-1">{r.desc}</p>
            </a>
          ))}
        </div>

        {/* FAQ */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-primary" /> Veelgestelde vragen
          </h3>
          <div className="space-y-4">
            {faqs.map((f) => (
              <div key={f.q} className="pb-4 border-b border-border last:border-0 last:pb-0">
                <p className="text-sm font-medium">{f.q}</p>
                <p className="text-xs text-muted-foreground mt-1">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
