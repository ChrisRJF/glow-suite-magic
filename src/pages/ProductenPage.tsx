import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useProducts } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { formatEuro } from "@/lib/data";
import { Package, Search, Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function ProductenPage() {
  const { data: products, loading, refetch } = useProducts();
  const { insert, update, remove } = useCrud("products");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', category: '', price: 0, stock: 0, description: '', is_active: true });

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.category || '').toLowerCase().includes(search.toLowerCase())
  );

  const close = () => { setShowForm(false); setEditingId(null); setForm({ name: '', category: '', price: 0, stock: 0, description: '', is_active: true }); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Naam is verplicht"); return; }
    if (editingId) {
      if (await update(editingId, form)) { toast.success("Product bijgewerkt"); close(); refetch(); }
    } else {
      if (await insert(form)) { toast.success("Product toegevoegd"); close(); refetch(); }
    }
  };

  const handleDelete = async (id: string) => {
    if (await remove(id)) { toast.success("Product verwijderd"); refetch(); }
  };

  const openEdit = (p: any) => {
    setEditingId(p.id);
    setForm({ name: p.name, category: p.category || '', price: p.price, stock: p.stock || 0, description: p.description || '', is_active: p.is_active ?? true });
    setShowForm(true);
  };

  return (
    <AppLayout title="Producten" subtitle="Productoverzicht en voorraad"
      actions={<Button variant="gradient" size="sm" onClick={() => { close(); setShowForm(true); }}><Plus className="w-4 h-4" /> Nieuw product</Button>}>

      <ConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
        title="Product verwijderen?"
        description="Dit product wordt permanent verwijderd."
        confirmLabel="Verwijderen"
        destructive
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
      />

      {showForm && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={close}>
          <div className="glass-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">{editingId ? 'Product bewerken' : 'Nieuw product'}</h3>
            <div className="space-y-3">
              <div><label className="text-xs text-muted-foreground">Naam *</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              <div><label className="text-xs text-muted-foreground">Categorie</label><input value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-muted-foreground">Prijs (€)</label><input type="number" step="0.01" value={form.price} onChange={e => setForm({...form, price: parseFloat(e.target.value) || 0})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-xs text-muted-foreground">Voorraad</label><input type="number" value={form.stock} onChange={e => setForm({...form, stock: parseInt(e.target.value) || 0})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              </div>
              <div><label className="text-xs text-muted-foreground">Beschrijving</label><textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[60px]" /></div>
              <div className="flex items-center gap-2"><input type="checkbox" checked={form.is_active} onChange={e => setForm({...form, is_active: e.target.checked})} className="rounded" /><label className="text-sm">Actief</label></div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={close}>Annuleren</Button>
              <Button variant="gradient" className="flex-1" onClick={handleSave}>Opslaan</Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6">
        {/* Low stock alerts */}
        {products.filter(p => (p.stock || 0) > 0 && (p.stock || 0) < 5).length > 0 && (
          <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Lage voorraad waarschuwing</p>
              <p className="text-xs text-muted-foreground mt-1">
                {products.filter(p => (p.stock || 0) > 0 && (p.stock || 0) < 5).map(p => `${p.name} (${p.stock})`).join(", ")}
              </p>
            </div>
          </div>
        )}

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Zoek producten..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>

        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-muted-foreground p-4">Product</th>
                <th className="text-left text-xs font-medium text-muted-foreground p-4">Categorie</th>
                <th className="text-right text-xs font-medium text-muted-foreground p-4">Prijs</th>
                <th className="text-right text-xs font-medium text-muted-foreground p-4">Voorraad</th>
                <th className="text-right text-xs font-medium text-muted-foreground p-4">Acties</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">Laden...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">Geen producten gevonden</td></tr>
              ) : filtered.map((p) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors group">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-secondary"><Package className="w-4 h-4 text-primary" /></div>
                      <span className="text-sm font-medium">{p.name}</span>
                      {!p.is_active && <span className="text-[10px] text-warning">Inactief</span>}
                    </div>
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">{p.category || '—'}</td>
                  <td className="p-4 text-sm text-right font-medium">{formatEuro(p.price)}</td>
                  <td className="p-4 text-right">
                    <span className={`text-sm font-medium ${(p.stock || 0) < 10 ? "text-destructive" : "text-success"}`}>{p.stock || 0}</span>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-secondary"><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></button>
                      <button onClick={() => setConfirmDeleteId(p.id)} className="p-1.5 rounded-lg hover:bg-destructive/20"><Trash2 className="w-3.5 h-3.5 text-destructive" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
}
