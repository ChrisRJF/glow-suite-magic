import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Mail, Phone, Building2, Sparkles, RefreshCw, Search, Trash2, ExternalLink, Loader2,
} from "lucide-react";

type DemoRequest = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  salon_name: string | null;
  salon_type: string | null;
  message: string | null;
  source: string;
  status: string;
  followed_up_at: string | null;
  follow_up_notes: string | null;
  created_at: string;
};

const STATUS_OPTIONS = [
  { value: "new", label: "Nieuw", color: "bg-primary/10 text-primary" },
  { value: "contacted", label: "Gecontacteerd", color: "bg-warning/10 text-warning" },
  { value: "qualified", label: "Gekwalificeerd", color: "bg-accent/10 text-accent-foreground" },
  { value: "won", label: "Klant", color: "bg-success/10 text-success" },
  { value: "lost", label: "Geen interesse", color: "bg-muted text-muted-foreground" },
];

function statusMeta(s: string) {
  return STATUS_OPTIONS.find((x) => x.value === s) ?? STATUS_OPTIONS[0];
}

function formatDate(d: string) {
  return new Date(d).toLocaleString("nl-NL", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function AdminDemoRequestsPage() {
  const [items, setItems] = useState<DemoRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<DemoRequest | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("demo_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setItems((data || []) as DemoRequest[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return items.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        return (
          r.name.toLowerCase().includes(s)
          || r.email.toLowerCase().includes(s)
          || (r.salon_name?.toLowerCase().includes(s) ?? false)
          || (r.phone?.toLowerCase().includes(s) ?? false)
        );
      }
      return true;
    });
  }, [items, statusFilter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const opt of STATUS_OPTIONS) c[opt.value] = 0;
    for (const r of items) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [items]);

  async function updateStatus(id: string, status: string) {
    const followed = status !== "new" ? new Date().toISOString() : null;
    const { error } = await supabase
      .from("demo_requests")
      .update({ status, followed_up_at: followed })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Status bijgewerkt");
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status, followed_up_at: followed } : r)));
    if (active?.id === id) setActive({ ...active, status, followed_up_at: followed });
  }

  async function saveNotes() {
    if (!active) return;
    setSaving(true);
    const { error } = await supabase
      .from("demo_requests")
      .update({ follow_up_notes: notes })
      .eq("id", active.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Notitie opgeslagen");
    setItems((prev) => prev.map((r) => (r.id === active.id ? { ...r, follow_up_notes: notes } : r)));
    setActive({ ...active, follow_up_notes: notes });
  }

  async function remove(id: string) {
    if (!confirm("Aanvraag verwijderen?")) return;
    const { error } = await supabase.from("demo_requests").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setItems((prev) => prev.filter((r) => r.id !== id));
    setActive(null);
    toast.success("Verwijderd");
  }

  function openDetail(r: DemoRequest) {
    setActive(r);
    setNotes(r.follow_up_notes || "");
  }

  return (
    <AppLayout title="Demo-aanvragen" subtitle="Leads van de landingpagina">
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Zoek op naam, e-mail, salon..."
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle statussen ({counts.all || 0})</SelectItem>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label} ({counts[o.value] || 0})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Vernieuwen
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Laden...
          </div>
        ) : filtered.length === 0 ? (
          <Card className="p-10 text-center">
            <Sparkles className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-semibold">Nog geen aanvragen</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Demo-aanvragen via de landingpagina verschijnen hier.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3">
            {filtered.map((r) => {
              const meta = statusMeta(r.status);
              return (
                <Card
                  key={r.id}
                  className="p-4 hover:border-primary/40 transition-colors cursor-pointer"
                  onClick={() => openDetail(r)}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold truncate">{r.name}</h3>
                        <Badge className={meta.color} variant="secondary">{meta.label}</Badge>
                        {r.source !== "landing" && (
                          <Badge variant="outline" className="text-xs">{r.source}</Badge>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> {r.email}</span>
                        {r.phone && <span className="inline-flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {r.phone}</span>}
                        {r.salon_name && <span className="inline-flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> {r.salon_name}{r.salon_type ? ` · ${r.salon_type}` : ""}</span>}
                      </div>
                      {r.message && (
                        <p className="text-sm text-foreground/80 mt-2 line-clamp-2">{r.message}</p>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(r.created_at)}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!active} onOpenChange={(v) => !v && setActive(null)}>
        <DialogContent className="sm:max-w-lg">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle>{active.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={statusMeta(active.status).color} variant="secondary">
                    {statusMeta(active.status).label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Aangevraagd op {formatDate(active.created_at)}
                  </span>
                </div>

                <div className="grid gap-2 text-sm">
                  <a href={`mailto:${active.email}`} className="inline-flex items-center gap-2 text-primary hover:underline">
                    <Mail className="w-4 h-4" /> {active.email} <ExternalLink className="w-3 h-3" />
                  </a>
                  {active.phone && (
                    <a href={`tel:${active.phone}`} className="inline-flex items-center gap-2 text-primary hover:underline">
                      <Phone className="w-4 h-4" /> {active.phone} <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {active.salon_name && (
                    <div className="inline-flex items-center gap-2 text-muted-foreground">
                      <Building2 className="w-4 h-4" /> {active.salon_name}{active.salon_type ? ` · ${active.salon_type}` : ""}
                    </div>
                  )}
                </div>

                {active.message && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Bericht</div>
                    <p className="text-sm bg-muted/40 rounded-lg p-3 whitespace-pre-wrap">{active.message}</p>
                  </div>
                )}

                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1.5">Status</div>
                  <Select value={active.status} onValueChange={(v) => updateStatus(active.id, v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1.5">Follow-up notitie</div>
                  <Textarea
                    rows={4}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Wat is besproken? Volgende stap?"
                  />
                  <Button size="sm" className="mt-2" onClick={saveNotes} disabled={saving}>
                    {saving && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                    Notitie opslaan
                  </Button>
                </div>

                <div className="flex justify-between pt-2 border-t border-border/60">
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(active.id)}>
                    <Trash2 className="w-4 h-4 mr-1" /> Verwijderen
                  </Button>
                  <Button asChild size="sm">
                    <a href={`mailto:${active.email}?subject=GlowSuite%20demo`}>
                      <Mail className="w-4 h-4 mr-1" /> Mail nu
                    </a>
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
