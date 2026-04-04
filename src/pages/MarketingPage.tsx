import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { MessageCircle, Mail, TrendingUp, Users, Send, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const campaigns = [
  { id: "1", name: "Winteractie 20% korting", channel: "WhatsApp", sent: 124, opened: 98, booked: 12, status: "actief" },
  { id: "2", name: "Valentijnsdag special", channel: "E-mail", sent: 89, opened: 45, booked: 8, status: "afgelopen" },
  { id: "3", name: "Heractivatie inactief", channel: "WhatsApp", sent: 34, opened: 28, booked: 5, status: "actief" },
];

const quickActions = [
  { label: "Last-minute deal versturen", icon: Zap, desc: "Stuur korting voor lege plekken vandaag" },
  { label: "Heractiveer inactieve klanten", icon: Users, desc: "Bereik klanten die 30+ dagen niet zijn geweest" },
  { label: "VIP campagne", icon: TrendingUp, desc: "Exclusieve aanbieding voor je beste klanten" },
];

const segments = [
  { name: "VIP klanten", count: 18, color: "text-primary" },
  { name: "Inactief (30+ dagen)", count: 12, color: "text-warning" },
  { name: "No-show risico", count: 5, color: "text-destructive" },
  { name: "Nieuwe klanten", count: 8, color: "text-emerald-400" },
];

export default function MarketingPage() {
  const [sending, setSending] = useState<string | null>(null);

  const handleAction = (label: string) => {
    setSending(label);
    setTimeout(() => {
      setSending(null);
      toast.success(`"${label}" is geactiveerd!`);
    }, 1200);
  };

  return (
    <AppLayout title="Marketing" subtitle="Campagnes, segmenten en automatiseringen">
      <div className="grid gap-6">
        {/* Quick actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {quickActions.map((a) => (
            <button
              key={a.label}
              onClick={() => handleAction(a.label)}
              disabled={sending === a.label}
              className="glass-card p-5 text-left hover:border-primary/30 transition-all group"
            >
              <a.icon className="w-5 h-5 text-primary mb-2 group-hover:scale-110 transition-transform" />
              <p className="text-sm font-semibold">{a.label}</p>
              <p className="text-xs text-muted-foreground mt-1">{a.desc}</p>
              {sending === a.label && (
                <p className="text-xs text-primary mt-2 animate-pulse">Bezig met versturen...</p>
              )}
            </button>
          ))}
        </div>

        {/* Segments */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4">Klantsegmenten</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {segments.map((s) => (
              <div key={s.name} className="p-3 rounded-xl bg-secondary/40 text-center">
                <p className={`text-xl font-bold ${s.color}`}>{s.count}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.name}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Campaigns */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Campagnes</h3>
            <Button size="sm" onClick={() => toast.info("Nieuwe campagne aanmaken wordt binnenkort beschikbaar")}>
              + Nieuwe campagne
            </Button>
          </div>
          <div className="space-y-3">
            {campaigns.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-4 rounded-xl bg-secondary/30">
                <div className="flex items-center gap-3">
                  {c.channel === "WhatsApp" ? (
                    <MessageCircle className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Mail className="w-4 h-4 text-primary" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.sent} verstuurd · {c.opened} geopend · {c.booked} geboekt
                    </p>
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  c.status === "actief" ? "bg-emerald-500/20 text-emerald-400" : "bg-secondary text-muted-foreground"
                }`}>
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
