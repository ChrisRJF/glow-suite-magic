import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { RefreshCw, Send, Clock, CheckCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const clientsWithout = [
  { id: "1", name: "Sophie de Vries", lastVisit: "6 weken geleden", service: "Knippen & Kleuren", phone: "+31 6 12345678" },
  { id: "2", name: "Emma Bakker", lastVisit: "5 weken geleden", service: "Gezichtsbehandeling", phone: "+31 6 87654321" },
  { id: "3", name: "Lisa Jansen", lastVisit: "8 weken geleden", service: "Manicure", phone: "+31 6 11223344" },
  { id: "4", name: "Anna Smit", lastVisit: "4 weken geleden", service: "Wenkbrauwen", phone: "+31 6 55667788" },
  { id: "5", name: "Femke Mulder", lastVisit: "7 weken geleden", service: "Knippen", phone: "+31 6 99887766" },
];

const suggestions = [
  { client: "Sophie de Vries", suggestion: "Knippen & Kleuren over 2 weken", confidence: 92 },
  { client: "Emma Bakker", suggestion: "Gezichtsbehandeling volgende week", confidence: 85 },
  { client: "Lisa Jansen", suggestion: "Manicure deze week", confidence: 78 },
];

export default function HerboekingenPage() {
  const [sentIds, setSentIds] = useState<string[]>([]);

  const handleSend = (id: string, name: string) => {
    setSentIds((prev) => [...prev, id]);
    toast.success(`Herboekvoorstel verstuurd naar ${name}`);
  };

  const handleSendAll = () => {
    const unsent = clientsWithout.filter((c) => !sentIds.includes(c.id));
    setSentIds(clientsWithout.map((c) => c.id));
    toast.success(`${unsent.length} herboekvoorstellen verstuurd`);
  };

  return (
    <AppLayout title="Herboekingen" subtitle="Maximaliseer terugkerende afspraken">
      <div className="grid gap-6">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="stat-card">
            <p className="text-xs text-muted-foreground">Herboekingspercentage</p>
            <p className="text-2xl font-bold mt-1">64%</p>
            <p className="text-xs text-muted-foreground mt-1">Doel: 80%</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-muted-foreground">Zonder afspraak</p>
            <p className="text-2xl font-bold mt-1">{clientsWithout.length}</p>
            <p className="text-xs text-destructive mt-1">Actie vereist</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-muted-foreground">Voorstellen verstuurd</p>
            <p className="text-2xl font-bold mt-1">{sentIds.length}</p>
            <p className="text-xs text-emerald-400 mt-1">Vandaag</p>
          </div>
        </div>

        {/* AI Suggestions */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary" /> AI Herboeksuggesties
          </h3>
          <div className="space-y-3">
            {suggestions.map((s) => (
              <div key={s.client} className="flex items-center justify-between p-3 rounded-xl bg-secondary/50">
                <div>
                  <p className="text-sm font-medium">{s.client}</p>
                  <p className="text-xs text-muted-foreground">{s.suggestion}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-primary font-medium">{s.confidence}% match</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Clients without appointment */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-warning" /> Klanten zonder afspraak
            </h3>
            <Button size="sm" onClick={handleSendAll} className="text-xs">
              <Send className="w-3 h-3 mr-1" /> Stuur naar allemaal
            </Button>
          </div>
          <div className="space-y-2">
            {clientsWithout.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors">
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.service} · {c.lastVisit}</p>
                </div>
                {sentIds.includes(c.id) ? (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Verstuurd
                  </span>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => handleSend(c.id, c.name)} className="text-xs">
                    <Send className="w-3 h-3 mr-1" /> Verstuur
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
