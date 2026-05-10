import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useCustomers, useAppointments, useServices } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { formatEuro } from "@/lib/data";
import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Phone, Mail, Calendar, Euro, ArrowRight, X, Plus, Trash2, Pencil, Save, Star, AlertTriangle, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CustomerAIProfile } from "@/components/CustomerAIProfile";
import type { Tables } from "@/integrations/supabase/types";
import { useUserRole } from "@/hooks/useUserRole";
import { useCustomerIntelligence } from "@/hooks/useCustomerIntelligence";

export default function CustomersPage() {
  const { data: customers, loading, refetch } = useCustomers();
  const { data: appointments } = useAppointments();
  const { data: services } = useServices();
  const { byId: intelById } = useCustomerIntelligence();
  const { insert, update, remove } = useCrud("customers");
  const { can } = useUserRole();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Tables<"customers"> | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' });
  const [filterLabel, setFilterLabel] = useState<string>(() => {
    const f = searchParams.get("filter");
    return f || "alle";
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const customerIntel = useMemo(() => {
    return customers.map(c => {
      const custAppts = appointments.filter(a => a.customer_id === c.id && a.status !== 'geannuleerd');
      const lastAppt = custAppts.sort((a, b) => new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime())[0];
      const daysSinceLast = lastAppt ? Math.floor((Date.now() - new Date(lastAppt.appointment_date).getTime()) / 86400000) : 999;
      const avgSpend = custAppts.length > 0 ? custAppts.reduce((s, a) => s + (Number(a.price) || 0), 0) / custAppts.length : 0;
      const isVip = c.is_vip || ((Number(c.total_spent) || 0) > 500 && custAppts.length >= 5);
      const isRisk = (c.no_show_count || 0) > 0 || (c.cancellation_count || 0) > 2;
      const isNew = custAppts.length <= 2;
      const label = isVip ? "VIP" : isRisk ? "Risico" : isNew ? "Nieuw" : "Regulier";
      return { ...c, custAppts, lastAppt, daysSinceLast, avgSpend, label, isVip, isRisk, isNew };
    });
  }, [customers, appointments]);

  const filtered = customerIntel.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase());
    const matchLabel = filterLabel === "alle" || c.label.toLowerCase() === filterLabel;
    return matchSearch && matchLabel;
  });

  const handleAdd = async () => {
    if (!can("customers:create")) { toast.error("Je hebt geen rechten om klanten toe te voegen."); return; }
    if (!form.name.trim()) { toast.error("Naam is verplicht"); return; }
    const result = await insert(form);
    if (result) { toast.success("Klant toegevoegd"); setShowAdd(false); setForm({ name: '', phone: '', email: '', notes: '' }); refetch(); }
  };

  const handleUpdate = async () => {
    if (!can("customers:update")) { toast.error("Je hebt geen rechten om klanten te wijzigen."); return; }
    if (!selectedCustomer) return;
    const result = await update(selectedCustomer.id, form);
    if (result) { toast.success("Klant bijgewerkt"); setEditing(false); refetch(); setSelectedCustomer({ ...selectedCustomer, ...form }); }
  };

  const handleDelete = async (id: string) => {
    if (!can("customers:delete")) { toast.error("Alleen eigenaren en managers kunnen klanten verwijderen."); return; }
    if (await remove(id)) { toast.success("Klant verwijderd"); setSelectedCustomer(null); refetch(); }
  };

  const selectedIntel = selectedCustomer ? customerIntel.find(c => c.id === selectedCustomer.id) : null;

  const initials = (name: string) => name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

  const getLabelBadge = (label: string) => {
    switch (label) {
      case "VIP": return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-warning/15 text-warning"><Star className="w-3 h-3" />VIP</span>;
      case "Risico": return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-destructive/15 text-destructive"><AlertTriangle className="w-3 h-3" />Risico</span>;
      case "Nieuw": return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-primary/15 text-primary"><UserCheck className="w-3 h-3" />Nieuw</span>;
      default: return null;
    }
  };

  return (
    <AppLayout title="Klanten" subtitle={`${customers.length} klanten in je salon`}
      actions={can("customers:create") ? <Button variant="gradient" size="sm" onClick={() => { setShowAdd(true); setForm({ name: '', phone: '', email: '', notes: '' }); }}><Plus className="w-4 h-4" /> Nieuwe klant</Button> : undefined}>

      <ConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
        title="Klant verwijderen?"
        description="Deze klant en alle gekoppelde data wordt verwijderd. Deze actie kan niet ongedaan worden gemaakt."
        confirmLabel="Verwijderen"
        destructive
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
      />

      {showAdd && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="glass-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Nieuwe klant</h3>
            <div className="space-y-3">
              <div><label className="text-xs text-muted-foreground">Naam *</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              <div><label className="text-xs text-muted-foreground">Telefoon</label><input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              <div><label className="text-xs text-muted-foreground">E-mail</label><input value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              <div><label className="text-xs text-muted-foreground">Notities</label><textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[60px]" /></div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Annuleren</Button>
              <Button variant="gradient" className="flex-1" onClick={handleAdd}>Opslaan</Button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '50ms' }}>
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Zoek klanten..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full h-11 pl-10 pr-4 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow" />
        </div>
        <div className="flex gap-1 bg-secondary/50 p-1 rounded-xl">
          {["alle", "vip", "risico", "nieuw"].map(f => (
            <button key={f} onClick={() => setFilterLabel(f)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize",
                filterLabel === f ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>
              {f === "alle" ? "Alle" : f === "vip" ? "⭐ VIP" : f === "risico" ? "⚠️ Risico" : "🆕 Nieuw"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-6">
        <div className={cn("flex-1 space-y-2 opacity-0 animate-fade-in-up", selectedCustomer && "hidden lg:block")} style={{ animationDelay: '200ms' }}>
          {loading ? <p className="text-sm text-muted-foreground text-center py-8">Laden...</p> :
           filtered.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">Geen klanten gevonden</p> :
           filtered.map((customer) => (
            <button key={customer.id} onClick={() => { setSelectedCustomer(customer); setEditing(false); }}
              className={cn("w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-200 text-left group",
                selectedCustomer?.id === customer.id ? 'bg-primary/10 border border-primary/20' : 'bg-secondary/50 hover:bg-secondary border border-transparent')}>
              <div className="w-10 h-10 rounded-full gradient-bg flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-semibold text-primary-foreground">{initials(customer.name)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{customer.name}</p>
                  {getLabelBadge(customer.label)}
                </div>
                <p className="text-xs text-muted-foreground">{customer.phone || 'Geen telefoon'}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-semibold tabular-nums">{formatEuro(Number(customer.total_spent) || 0)}</p>
                <p className="text-xs text-muted-foreground">{customer.custAppts.length} bezoeken</p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </button>
          ))}
        </div>

        {selectedCustomer && selectedIntel && (
          <div className="w-full lg:w-[380px] glass-card p-6 opacity-0 animate-fade-in-up flex-shrink-0">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold">Klantprofiel</h3>
              <div className="flex gap-1">
                <button onClick={() => { setEditing(!editing); if (!editing) setForm({ name: selectedCustomer.name, phone: selectedCustomer.phone || '', email: selectedCustomer.email || '', notes: selectedCustomer.notes || '' }); }} className="p-1.5 rounded-lg hover:bg-secondary"><Pencil className="w-4 h-4" /></button>
                {can("customers:delete") && <button onClick={() => setConfirmDeleteId(selectedCustomer.id)} className="p-1.5 rounded-lg hover:bg-destructive/20 text-destructive"><Trash2 className="w-4 h-4" /></button>}
                <button onClick={() => setSelectedCustomer(null)} className="p-1.5 rounded-lg hover:bg-secondary lg:hidden"><X className="w-4 h-4" /></button>
              </div>
            </div>

            {editing ? (
              <div className="space-y-3 mb-6">
                <div><label className="text-xs text-muted-foreground">Naam</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-xs text-muted-foreground">Telefoon</label><input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-xs text-muted-foreground">E-mail</label><input value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-xs text-muted-foreground">Notities</label><textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[60px]" /></div>
                <Button variant="gradient" className="w-full" onClick={handleUpdate}><Save className="w-4 h-4" /> Opslaan</Button>
              </div>
            ) : (
              <>
                <div className="flex flex-col items-center mb-6">
                  <div className="w-16 h-16 rounded-2xl gradient-bg flex items-center justify-center mb-3">
                    <span className="text-xl font-bold text-primary-foreground">{initials(selectedCustomer.name)}</span>
                  </div>
                  <h4 className="text-base font-semibold">{selectedCustomer.name}</h4>
                  <div className="mt-1">{getLabelBadge(selectedIntel.label)}</div>
                </div>
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50"><Phone className="w-4 h-4 text-muted-foreground" /><span className="text-sm">{selectedCustomer.phone || '—'}</span></div>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50"><Mail className="w-4 h-4 text-muted-foreground" /><span className="text-sm">{selectedCustomer.email || '—'}</span></div>
                </div>
                {/* AI-powered customer intelligence */}
                <div className="mb-6">
                  {intelById.get(selectedCustomer.id) ? (
                    <CustomerAIProfile intel={intelById.get(selectedCustomer.id)!} />
                  ) : null}
                </div>
                {selectedCustomer.notes && <div className="p-3 rounded-xl bg-secondary/50 mb-4"><p className="text-xs text-muted-foreground mb-1">Notities</p><p className="text-sm">{selectedCustomer.notes}</p></div>}
              </>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
