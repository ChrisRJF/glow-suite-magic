import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useWaitlist, useCustomers, useServices } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { Clock, Plus, UserPlus, CalendarPlus, Send, Trash2, CheckCircle2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MEDEWERKERS = ["Bas", "Roos", "Lisa", "Emma"];
const FLEX_OPTIONS = ["flexibel", "alleen ochtend", "alleen middag", "specifieke dag"];

export default function WachtlijstPage() {
  const { data: waitlist, refetch } = useWaitlist();
  const { data: customers } = useCustomers();
  const { data: services } = useServices();
  const { insert, update, remove } = useCrud("waitlist_entries");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    customer_id: "", service_id: "", preferred_employee: "",
    preferred_day: "", preferred_time: "", flexibility: "flexibel", notes: "",
  });

  const handleAdd = async () => {
    if (!form.customer_id) { toast.error("Kies een klant"); return; }
    if (!form.service_id) { toast.error("Kies een behandeling"); return; }
    await insert({ ...form, status: "wachtend" });
    toast.success("Klant toegevoegd aan wachtlijst");
    setShowForm(false);
    setForm({ customer_id: "", service_id: "", preferred_employee: "", preferred_day: "", preferred_time: "", flexibility: "flexibel", notes: "" });
    refetch();
  };

  const handlePlace = async (id: string) => {
    await update(id, { status: "geplaatst" });
    toast.success("Klant geplaatst in agenda");
    refetch();
  };

  const handleNotify = async (id: string) => {
    toast.success("Bericht verstuurd naar klant (demo)");
  };

  const handleRemove = async (id: string) => {
    await remove(id);
    toast.success("Verwijderd van wachtlijst");
    refetch();
  };

  const getCustomerName = (id: string | null) => customers.find(c => c.id === id)?.name || "Onbekend";
  const getServiceName = (id: string | null) => services.find(s => s.id === id)?.name || "Onbekend";

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      wachtend: "bg-warning/15 text-warning",
      geplaatst: "bg-success/15 text-success",
      geannuleerd: "bg-muted text-muted-foreground",
    };
    return <span className={cn("px-2 py-0.5 rounded-lg text-[11px] font-medium", map[status] || map.wachtend)}>{status}</span>;
  };

  const wachtend = waitlist.filter(w => (w as any).status === "wachtend");
  const geplaatst = waitlist.filter(w => (w as any).status === "geplaatst");

  return (
    <AppLayout title="Wachtlijst" subtitle="Klanten die wachten op een plek"
      actions={<Button variant="gradient" size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Toevoegen</Button>}>

      {showForm && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="glass-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><UserPlus className="w-5 h-5 text-primary" /> Toevoegen aan wachtlijst</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Klant *</label>
                <select value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">Kies klant...</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Behandeling *</label>
                <select value={form.service_id} onChange={e => setForm({ ...form, service_id: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">Kies behandeling...</option>
                  {services.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Voorkeursmedewerker</label>
                <select value={form.preferred_employee} onChange={e => setForm({ ...form, preferred_employee: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">Geen voorkeur</option>
                  {MEDEWERKERS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Voorkeursdag</label>
                  <select value={form.preferred_day} onChange={e => setForm({ ...form, preferred_day: e.target.value })}
                    className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                    <option value="">Geen voorkeur</option>
                    {["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Voorkeurstijd</label>
                  <input type="time" value={form.preferred_time} onChange={e => setForm({ ...form, preferred_time: e.target.value })}
                    className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Flexibiliteit</label>
                <select value={form.flexibility} onChange={e => setForm({ ...form, flexibility: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  {FLEX_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Notities</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[60px]" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Annuleren</Button>
              <Button variant="gradient" className="flex-1" onClick={handleAdd}>Toevoegen</Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="glass-card p-4">
            <p className="text-2xl font-bold text-warning">{wachtend.length}</p>
            <p className="text-xs text-muted-foreground">Wachtend</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-2xl font-bold text-success">{geplaatst.length}</p>
            <p className="text-xs text-muted-foreground">Geplaatst</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-2xl font-bold">{waitlist.length}</p>
            <p className="text-xs text-muted-foreground">Totaal</p>
          </div>
        </div>

        {/* Active waitlist */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" /> Actieve wachtlijst
          </h3>
          <div className="space-y-2">
            {wachtend.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Geen klanten op de wachtlijst</p>
            ) : wachtend.map((w: any) => (
              <div key={w.id} className="p-4 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold">{getCustomerName(w.customer_id)}</p>
                    <p className="text-xs text-muted-foreground">{getServiceName(w.service_id)}</p>
                  </div>
                  {statusBadge(w.status)}
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground mb-3">
                  {w.preferred_employee && <span className="bg-secondary px-2 py-0.5 rounded-md">👤 {w.preferred_employee}</span>}
                  {w.preferred_day && <span className="bg-secondary px-2 py-0.5 rounded-md">📅 {w.preferred_day}</span>}
                  {w.preferred_time && <span className="bg-secondary px-2 py-0.5 rounded-md">🕐 {w.preferred_time}</span>}
                  <span className="bg-secondary px-2 py-0.5 rounded-md">🔄 {w.flexibility}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="gradient" size="sm" onClick={() => handlePlace(w.id)}>
                    <CalendarPlus className="w-3.5 h-3.5" /> Plaats in agenda
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleNotify(w.id)}>
                    <Send className="w-3.5 h-3.5" /> Stuur bericht
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleRemove(w.id)}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Placed */}
        {geplaatst.length > 0 && (
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-success" /> Recent geplaatst
            </h3>
            <div className="space-y-2">
              {geplaatst.map((w: any) => (
                <div key={w.id} className="flex items-center justify-between p-3 rounded-xl bg-success/5">
                  <div>
                    <p className="text-sm font-medium">{getCustomerName(w.customer_id)}</p>
                    <p className="text-xs text-muted-foreground">{getServiceName(w.service_id)}</p>
                  </div>
                  {statusBadge(w.status)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}