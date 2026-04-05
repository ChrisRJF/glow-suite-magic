import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useCustomers, useAppointments, useRebookActions } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { RefreshCw, Send, Clock, CheckCircle } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

export default function HerboekingenPage() {
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const { data: rebookActions, refetch } = useRebookActions();
  const { insert } = useCrud("rebook_actions");
  const [sentIds, setSentIds] = useState<string[]>([]);

  const withoutNext = useMemo(() =>
    customers.filter(c => {
      const future = appointments.find(a => a.customer_id === c.id && new Date(a.appointment_date) > new Date() && a.status !== 'geannuleerd');
      return !future;
    }).map(c => {
      const lastAppt = appointments
        .filter(a => a.customer_id === c.id && a.status !== 'geannuleerd')
        .sort((a, b) => new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime())[0];
      const weeksAgo = lastAppt ? Math.floor((Date.now() - new Date(lastAppt.appointment_date).getTime()) / (7 * 86400000)) : 0;
      return { ...c, lastVisitWeeks: weeksAgo, lastService: lastAppt ? 'Behandeling' : 'Onbekend' };
    }), [customers, appointments]
  );

  const rebookPct = customers.length > 0 ? Math.round(((customers.length - withoutNext.length) / customers.length) * 100) : 0;
  const alreadySent = rebookActions.map(r => r.customer_id);

  const handleSend = async (customerId: string, name: string) => {
    await insert({ customer_id: customerId, status: 'verzonden', suggested_date: new Date(Date.now() + 7 * 86400000).toISOString() });
    setSentIds(prev => [...prev, customerId]);
    toast.success(`Herboekvoorstel verstuurd naar ${name}`);
    refetch();
  };

  const handleSendAll = async () => {
    const unsent = withoutNext.filter(c => !sentIds.includes(c.id) && !alreadySent.includes(c.id));
    for (const c of unsent) {
      await insert({ customer_id: c.id, status: 'verzonden', suggested_date: new Date(Date.now() + 7 * 86400000).toISOString() });
    }
    setSentIds(withoutNext.map(c => c.id));
    toast.success(`${unsent.length} herboekvoorstellen verstuurd`);
    refetch();
  };

  const isSent = (id: string) => sentIds.includes(id) || alreadySent.includes(id);

  return (
    <AppLayout title="Herboekingen" subtitle="Maximaliseer terugkerende afspraken">
      <div className="grid gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="stat-card"><p className="text-xs text-muted-foreground">Herboekingspercentage</p><p className="text-2xl font-bold mt-1">{rebookPct}%</p><p className="text-xs text-muted-foreground mt-1">Doel: 80%</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground">Zonder afspraak</p><p className="text-2xl font-bold mt-1">{withoutNext.length}</p><p className="text-xs text-destructive mt-1">Actie vereist</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground">Voorstellen verstuurd</p><p className="text-2xl font-bold mt-1">{rebookActions.length + sentIds.length}</p><p className="text-xs text-success mt-1">Totaal</p></div>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Clock className="w-4 h-4 text-warning" /> Klanten zonder afspraak</h3>
            <Button size="sm" onClick={handleSendAll} className="text-xs"><Send className="w-3 h-3 mr-1" /> Stuur naar allemaal</Button>
          </div>
          <div className="space-y-2">
            {withoutNext.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">Alle klanten hebben een afspraak 🎉</p> :
            withoutNext.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors">
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.lastVisitWeeks > 0 ? `${c.lastVisitWeeks} weken geleden` : 'Nog geen bezoek'}</p>
                </div>
                {isSent(c.id) ? (
                  <span className="text-xs text-success flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Verstuurd</span>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => handleSend(c.id, c.name)} className="text-xs"><Send className="w-3 h-3 mr-1" /> Verstuur</Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
