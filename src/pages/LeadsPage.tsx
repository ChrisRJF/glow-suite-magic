import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useLeads } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { useState } from "react";
import { Search, Plus, UserPlus, UserCheck, Phone, Mail, X, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";

const STATUS_OPTIONS = [
  { value: "nieuw", label: "Nieuw", color: "bg-primary/15 text-primary" },
  { value: "opgevolgd", label: "Opgevolgd", color: "bg-warning/15 text-warning" },
  { value: "klant_geworden", label: "Klant geworden", color: "bg-success/15 text-success" },
];

export default function LeadsPage() {
  const { data: leads, loading, refetch } = useLeads();
  const { insert, update, remove } = useCrud("leads");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("alle");
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", source: "handmatig", notes: "" });

  const filtered = leads.filter(l => {
    const matchSearch = l.name.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "alle" || l.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const handleAdd = async () => {
    if (!form.name.trim()) { toast.error("Naam is verplicht"); return; }
    const result = await insert({ ...form, status: "nieuw" });
    if (result) { toast.success("Lead toegevoegd"); setShowAdd(false); setForm({ name: "", phone: "", email: "", source: "handmatig", notes: "" }); refetch(); }
  };

  const handleStatusChange = async (id: string, status: string) => {
    const result = await update(id, { status, ...(status === "opgevolgd" ? { followed_up_at: new Date().toISOString() } : {}) });
    if (result) { toast.success(`Status bijgewerkt naar ${STATUS_OPTIONS.find(s => s.value === status)?.label}`); refetch(); }
  };

  const handleDelete = async (id: string) => {
    if (await remove(id)) { toast.success("Lead verwijderd"); refetch(); }
  };

  const statusBadge = (status: string) => {
    const opt = STATUS_OPTIONS.find(s => s.value === status);
    return <span className={cn("px-2 py-0.5 rounded-md text-[11px] font-medium", opt?.color || "bg-secondary text-muted-foreground")}>{opt?.label || status}</span>;
  };

  const stats = [
    { label: "Nieuw", count: leads.filter(l => l.status === "nieuw").length, color: "text-primary" },
    { label: "Opgevolgd", count: leads.filter(l => l.status === "opgevolgd").length, color: "text-warning" },
    { label: "Klant geworden", count: leads.filter(l => l.status === "klant_geworden").length, color: "text-success" },
  ];

  return (
    <AppLayout title="Leads" subtitle="Potentiële klanten die nog niet geboekt hebben"
      actions={<Button variant="gradient" size="sm" onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Nieuwe lead</Button>}>

      <ConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
        title="Lead verwijderen?"
        description="Deze lead wordt permanent verwijderd."
        confirmLabel="Verwijderen"
        destructive
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
      />

      {showAdd && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="glass-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Nieuwe lead</h3>
            <div className="space-y-3">
              <div><label className="text-xs text-muted-foreground">Naam *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              <div><label className="text-xs text-muted-foreground">Telefoon</label><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              <div><label className="text-xs text-muted-foreground">E-mail</label><input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              <div>
                <label className="text-xs text-muted-foreground">Bron</label>
                <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="handmatig">Handmatig</option>
                  <option value="website">Website</option>
                  <option value="instagram">Instagram</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="referral">Doorverwijzing</option>
                </select>
              </div>
              <div><label className="text-xs text-muted-foreground">Notities</label><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[60px]" /></div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Annuleren</Button>
              <Button variant="gradient" className="flex-1" onClick={handleAdd}>Opslaan</Button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {stats.map((s, i) => (
          <div key={s.label} className="stat-card opacity-0 animate-fade-in-up" style={{ animationDelay: `${i * 80}ms` }}>
            <p className={cn("text-2xl font-bold tabular-nums", s.color)}>{s.count}</p>
            <p className="text-sm text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Zoek leads..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full h-11 pl-10 pr-4 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <div className="flex gap-1 bg-secondary/50 p-1 rounded-xl">
          {["alle", ...STATUS_OPTIONS.map(s => s.value)].map(f => (
            <button key={f} onClick={() => setFilterStatus(f)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize",
                filterStatus === f ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>
              {f === "alle" ? "Alle" : STATUS_OPTIONS.find(s => s.value === f)?.label || f}
            </button>
          ))}
        </div>
      </div>

      {/* Leads List */}
      <div className="space-y-2">
        {loading ? <p className="text-sm text-muted-foreground text-center py-8">Laden...</p> :
         filtered.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">Geen leads gevonden</p> :
         filtered.map(lead => (
          <div key={lead.id} className="flex items-center gap-4 p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors group">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <UserPlus className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-medium">{lead.name}</p>
                {statusBadge(lead.status)}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {lead.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{lead.phone}</span>}
                {lead.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{lead.email}</span>}
                <span>Bron: {lead.source}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {lead.status === "nieuw" && (
                <Button variant="outline" size="sm" onClick={() => handleStatusChange(lead.id, "opgevolgd")}>
                  <ArrowRight className="w-3.5 h-3.5" /> Opvolgen
                </Button>
              )}
              {lead.status === "opgevolgd" && (
                <Button variant="gradient" size="sm" onClick={() => handleStatusChange(lead.id, "klant_geworden")}>
                  <UserCheck className="w-3.5 h-3.5" /> Klant geworden
                </Button>
              )}
              <button onClick={() => setConfirmDeleteId(lead.id)} className="p-1.5 rounded-lg hover:bg-destructive/20 text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </AppLayout>
  );
}