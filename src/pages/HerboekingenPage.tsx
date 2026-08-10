import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useCustomers, useAppointments, useServices, useRebookActions } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { Send, Clock, CheckCircle } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { calculateAutoRebook, type AutoRebookDecision } from "@/lib/autoRebook";

const REASON_LABELS: Record<string, string> = {
  overdue: "Toe aan een nieuwe afspraak",
  never_returned: "Kwam nooit terug",
  due_soon: "Bijna toe aan een afspraak",
};

export default function HerboekingenPage() {
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const { data: services } = useServices();
  const { data: rebookActions, refetch } = useRebookActions();
  const [sentIds, setSentIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Eén bron van waarheid: dezelfde Auto Rebook engine als de backend.
  const dueList = useMemo(() => {
    const serviceIntervals: Record<string, number | null> = {};
    const servicePrices: Record<string, number | null> = {};
    for (const s of (services as any[]) || []) {
      serviceIntervals[s.id] = s.rebook_interval_days ?? null;
      servicePrices[s.id] = Number(s.price ?? 0) || null;
    }
    const byCustomer = new Map<string, any[]>();
    for (const a of (appointments as any[]) || []) {
      if (!a.customer_id) continue;
      const arr = byCustomer.get(a.customer_id) || [];
      arr.push(a);
      byCustomer.set(a.customer_id, arr);
    }
    const rows: Array<{ id: string; name: string; decision: AutoRebookDecision }> = [];
    for (const c of (customers as any[]) || []) {
      const decision = calculateAutoRebook({
        customer_id: c.id,
        appointments: byCustomer.get(c.id) || [],
        serviceIntervals,
        servicePrices,
      });
      if (decision.should_rebook) rows.push({ id: c.id, name: c.name, decision });
    }
    return rows.sort((a, b) => (b.decision.days_overdue || 0) - (a.decision.days_overdue || 0));
  }, [customers, appointments, services]);

  const activeCustomers = ((customers as any[]) || []).length;
  const rebookPct = activeCustomers > 0
    ? Math.round(((activeCustomers - dueList.length) / activeCustomers) * 100)
    : 0;
  const alreadySent = ((rebookActions as any[]) || []).filter((r) => r.sent_at).map((r) => r.customer_id);
  const expectedRevenue = dueList.reduce((sum, r) => sum + Number(r.decision.estimated_value || 0), 0);

  const sendOne = async (customerId: string) => {
    const { data, error } = await supabase.functions.invoke("auto-rebook-send", {
      body: { customer_id: customerId },
    });
    if (error) throw new Error(error.message);
    if ((data as any)?.skipped) throw new Error("Al verstuurd of geen kanaal beschikbaar");
    return data;
  };

  const handleSend = async (customerId: string, name: string) => {
    setBusyId(customerId);
    try {
      await sendOne(customerId);
      setSentIds((prev) => [...prev, customerId]);
      toast.success(`Herboekvoorstel verstuurd naar ${name}`);
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Versturen mislukt");
    } finally {
      setBusyId(null);
    }
  };

  const handleSendAll = async () => {
    const unsent = dueList.filter((c) => !sentIds.includes(c.id) && !alreadySent.includes(c.id));
    if (!unsent.length) { toast.info("Alles is al verstuurd"); return; }
    setBusyId("all");
    let ok = 0;
    for (const c of unsent) {
      try { await sendOne(c.id); ok++; } catch { /* per klant overslaan */ }
    }
    setSentIds((prev) => [...prev, ...unsent.map((c) => c.id)]);
    toast.success(`${ok} herboekvoorstellen verstuurd`);
    setBusyId(null);
    refetch();
  };

  const isSent = (id: string) => sentIds.includes(id) || alreadySent.includes(id);

  return (
    <AppLayout title="Herboekingen" subtitle="Maximaliseer terugkerende afspraken">
      <div className="grid gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="stat-card"><p className="text-xs text-muted-foreground">Herboekingspercentage</p><p className="text-2xl font-bold mt-1">{rebookPct}%</p><p className="text-xs text-muted-foreground mt-1">Doel: 80%</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground">Klanten nu toe</p><p className="text-2xl font-bold mt-1">{dueList.length}</p><p className="text-xs text-destructive mt-1">Actie vereist</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground">Verwachte omzet</p><p className="text-2xl font-bold mt-1">{expectedRevenue.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}</p><p className="text-xs text-success mt-1">Bij herboeking</p></div>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Clock className="w-4 h-4 text-warning" /> Klanten die toe zijn aan een afspraak</h3>
            <Button size="sm" onClick={handleSendAll} disabled={busyId !== null} className="text-xs"><Send className="w-3 h-3 mr-1" /> Stuur naar allemaal</Button>
          </div>
          <div className="space-y-2">
            {dueList.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">Iedereen zit op schema 🎉</p> :
            dueList.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors">
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {REASON_LABELS[c.decision.reason] || "Toe aan een nieuwe afspraak"}
                    {c.decision.days_overdue ? ` · ${c.decision.days_overdue} dagen over tijd` : ""}
                  </p>
                </div>
                {isSent(c.id) ? (
                  <span className="text-xs text-success flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Verstuurd</span>
                ) : (
                  <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => handleSend(c.id, c.name)} className="text-xs"><Send className="w-3 h-3 mr-1" /> Verstuur</Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
