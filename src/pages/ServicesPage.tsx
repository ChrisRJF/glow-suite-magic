import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useServices } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { formatEuro } from "@/lib/data";
import { Plus, Clock, Euro, Pencil, Trash2, Globe, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function ServicesPage() {
  const { data: services, loading, refetch } = useServices();
  const { insert, update, remove } = useCrud("services");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', duration_minutes: 30, price: 0, category: '', color: '#7B61FF', description: '',
    is_active: true, is_online_bookable: true, is_internal_only: false,
  });

  const categories = [...new Set(services.map(s => s.category).filter(Boolean))];

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Naam is verplicht"); return; }
    if (editingId) {
      const result = await update(editingId, form);
      if (result) { toast.success("Behandeling bijgewerkt"); close(); refetch(); }
    } else {
      const result = await insert(form);
      if (result) { toast.success("Behandeling toegevoegd"); close(); refetch(); }
    }
  };

  const handleDelete = async (id: string) => {
    if (await remove(id)) { toast.success("Behandeling verwijderd"); refetch(); }
  };

  const close = () => {
    setShowForm(false); setEditingId(null);
    setForm({ name: '', duration_minutes: 30, price: 0, category: '', color: '#7B61FF', description: '', is_active: true, is_online_bookable: true, is_internal_only: false });
  };

  const openEdit = (s: any) => {
    setEditingId(s.id);
    setForm({
      name: s.name, duration_minutes: s.duration_minutes, price: s.price,
      category: s.category || '', color: s.color || '#7B61FF', description: s.description || '',
      is_active: s.is_active ?? true, is_online_bookable: s.is_online_bookable ?? true, is_internal_only: s.is_internal_only ?? false,
    });
    setShowForm(true);
  };

  return (
    <AppLayout title="Behandelingen" subtitle="Beheer je behandelmenu."
      actions={<Button variant="gradient" size="sm" onClick={() => { close(); setShowForm(true); }}><Plus className="w-4 h-4" /> Behandeling Toevoegen</Button>}>

      <ConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
        title="Behandeling verwijderen?"
        description="Deze behandeling wordt permanent verwijderd."
        confirmLabel="Verwijderen"
        destructive
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
      />

      {showForm && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={close}>
          <div className="glass-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">{editingId ? 'Behandeling bewerken' : 'Nieuwe behandeling'}</h3>
            <div className="space-y-3">
              <div><label className="text-xs text-muted-foreground">Naam *</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-muted-foreground">Duur (min)</label><input type="number" value={form.duration_minutes} onChange={e => setForm({...form, duration_minutes: parseInt(e.target.value) || 0})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-xs text-muted-foreground">Prijs (€)</label><input type="number" step="0.01" value={form.price} onChange={e => setForm({...form, price: parseFloat(e.target.value) || 0})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              </div>
              <div><label className="text-xs text-muted-foreground">Categorie</label><input value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="bijv. Haar, Kleur, Styling" /></div>
              <div><label className="text-xs text-muted-foreground">Kleur</label><input type="color" value={form.color} onChange={e => setForm({...form, color: e.target.value})} className="w-full mt-1 h-10 rounded-xl" /></div>

              {/* Status & Visibility */}
              <div className="border-t border-border pt-3 space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground">Status & Zichtbaarheid</p>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm({...form, is_active: e.target.checked})} className="rounded" />
                  <label className="text-sm">Actief</label>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={form.is_online_bookable} onChange={e => setForm({...form, is_online_bookable: e.target.checked})} className="rounded" />
                  <label className="text-sm">Online boekbaar</label>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={form.is_internal_only} onChange={e => setForm({...form, is_internal_only: e.target.checked})} className="rounded" />
                  <label className="text-sm">Alleen intern zichtbaar</label>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={close}>Annuleren</Button>
              <Button variant="gradient" className="flex-1" onClick={handleSave}>Opslaan</Button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-8">
        {loading ? <p className="text-sm text-muted-foreground text-center py-8">Laden...</p> :
         services.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">Nog geen behandelingen. Voeg er een toe!</p> :
         (categories.length > 0 ? categories : ['']).map((category, ci) => {
           const catServices = services.filter(s => (s.category || '') === category);
           if (catServices.length === 0) return null;
           return (
             <div key={category || 'uncategorized'} className="opacity-0 animate-fade-in-up" style={{ animationDelay: `${ci * 100 + 100}ms` }}>
               {category && <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{category}</h3>}
               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                 {catServices.map((service) => (
                   <div key={service.id} className="glass-card p-5 group hover:border-primary/20 transition-all duration-200 hover:shadow-[0_0_20px_-5px_hsl(var(--glow-purple)/0.1)]">
                     <div className="flex items-start justify-between mb-3">
                       <div className="w-2.5 h-2.5 rounded-full mt-1.5" style={{ backgroundColor: service.color || '#7B61FF' }} />
                       <div className="flex gap-1">
                         <button onClick={() => openEdit(service)} className="p-1.5 rounded-lg hover:bg-secondary opacity-0 group-hover:opacity-100 transition-opacity"><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></button>
                         <button onClick={() => setConfirmDeleteId(service.id)} className="p-1.5 rounded-lg hover:bg-destructive/20 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-3.5 h-3.5 text-destructive" /></button>
                       </div>
                     </div>
                     <h4 className="text-sm font-semibold mb-3">{service.name}</h4>
                     <div className="flex items-center gap-4">
                       <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="w-3.5 h-3.5" /> {service.duration_minutes} min</span>
                       <span className="flex items-center gap-1 text-sm font-semibold tabular-nums"><Euro className="w-3.5 h-3.5 text-muted-foreground" />{formatEuro(service.price)}</span>
                     </div>
                     {/* Status badges */}
                     <div className="flex flex-wrap gap-1.5 mt-2.5">
                       {!service.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning font-medium">Inactief</span>}
                       {(service as any).is_online_bookable === false && (
                         <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-medium flex items-center gap-0.5"><EyeOff className="w-2.5 h-2.5" />Niet online</span>
                       )}
                       {(service as any).is_online_bookable !== false && service.is_active && (
                         <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium flex items-center gap-0.5"><Globe className="w-2.5 h-2.5" />Online</span>
                       )}
                       {(service as any).is_internal_only && (
                         <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-medium flex items-center gap-0.5"><Eye className="w-2.5 h-2.5" />Intern</span>
                       )}
                     </div>
                   </div>
                 ))}
               </div>
             </div>
           );
         })}
      </div>
    </AppLayout>
  );
}
