import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { toast } from "sonner";
import { Power, Plus, Smartphone, Star, Trash2, Copy, Check, ChevronDown } from "lucide-react";
import { WhyHint } from "@/components/WhyHint";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type Terminal = {
  id: string; terminal_id: string; terminal_name: string;
  location_name: string | null; status: string; last_seen_at: string | null;
  last_used_at: string | null; is_demo: boolean; is_default: boolean;
  source_terminal_id: string | null; virtual_id: string | null; serial_number: string | null;
};

function friendlyError(err: any): string {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "");
  if (code === "23505" || msg.includes("duplicate key") || msg.includes("unique constraint")) {
    return "Deze terminal is al gekoppeld.";
  }
  if (code === "42501" || msg.includes("row-level security") || msg.includes("permission")) {
    return "Je hebt geen toegang tot deze terminal.";
  }
  if (msg.includes("network") || msg.includes("fetch")) {
    return "Kon terminal niet opslaan. Probeer opnieuw.";
  }
  return "Er ging iets mis bij het opslaan van de terminal.";
}

function CopyableId({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Kopiëren mislukt");
    }
  };
  return (
    <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
      {label && <span className="text-muted-foreground shrink-0">{label}</span>}
      <span className="truncate font-mono text-[10px]" title={value}>{value}</span>
      <button type="button" onClick={copy} className="shrink-0 p-0.5 rounded hover:bg-secondary text-muted-foreground" aria-label="Kopieer">
        {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
      </button>
    </span>
  );
}

export function TerminalsCard() {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [loading, setLoading] = useState(false);
  const [tid, setTid] = useState("");
  const [tname, setTname] = useState("");
  const [tloc, setTloc] = useState("");
  const [tsource, setTsource] = useState("");
  const [tvirtual, setTvirtual] = useState("");
  const [tserial, setTserial] = useState("");
  const [tdefault, setTdefault] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Terminal | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const load = async () => {
    const { data } = await (supabase.from("viva_terminals").select("*") as any)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });
    setTerminals((data as any) || []);
  };
  useEffect(() => { load(); }, [demoMode]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const toggleExpanded = (id: string) => setExpandedIds(p => ({ ...p, [id]: !p[id] }));


  const cleanTid = tid.replace(/\s+/g, "");
  const existingDup = terminals.find(t => t.terminal_id === cleanTid && t.is_demo === demoMode);

  const add = async () => {
    setFormError(null);
    const name = tname.trim();
    const id = tid.replace(/\s+/g, "");
    if (!user) return;
    if (!name) { setFormError("Naam is verplicht."); return; }
    if (!id) { setFormError("Terminal ID is verplicht."); return; }
    if (existingDup) {
      setFormError("Deze terminal is al gekoppeld.");
      setHighlightId(existingDup.id);
      cardRefs.current[existingDup.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => setHighlightId(null), 2000);
      return;
    }
    setLoading(true);
    try {
      if (tdefault) {
        await (supabase.from("viva_terminals") as any).update({ is_default: false }).eq("user_id", user.id).eq("is_demo", demoMode);
      }
      const { error } = await supabase.from("viva_terminals").insert({
        user_id: user.id, is_demo: demoMode, terminal_id: id, terminal_name: name,
        location_name: tloc.trim() || null, status: "active",
        source_terminal_id: tsource.trim() || null,
        virtual_id: tvirtual.trim() || null,
        serial_number: tserial.trim() || null,
        is_default: tdefault,
      } as any);
      if (error) {
        const msg = friendlyError(error);
        setFormError(msg);
        if (msg === "Deze terminal is al gekoppeld.") {
          await load();
        }
        return;
      }
      setTid(""); setTname(""); setTloc(""); setTsource(""); setTvirtual(""); setTserial(""); setTdefault(false);
      toast.success("Terminal toegevoegd");
      load();
    } finally {
      setLoading(false);
    }
  };

  const toggle = async (t: Terminal) => {
    const next = t.status === "active" ? "inactive" : "active";
    const { error } = await supabase.from("viva_terminals").update({ status: next }).eq("id", t.id);
    if (error) toast.error(friendlyError(error)); else load();
  };

  const makeDefault = async (t: Terminal) => {
    if (!user) return;
    await (supabase.from("viva_terminals") as any).update({ is_default: false }).eq("user_id", user.id).eq("is_demo", t.is_demo);
    const { error } = await (supabase.from("viva_terminals") as any).update({ is_default: true }).eq("id", t.id);
    if (error) toast.error(friendlyError(error)); else { toast.success("Standaard pinapparaat ingesteld"); load(); }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const { error } = await supabase.from("viva_terminals").delete().eq("id", toDelete.id);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Terminal verwijderd");
    setToDelete(null);
    load();
  };

  return (
    <div className="rounded-xl border border-border bg-background/60 p-3 space-y-3 max-w-full overflow-hidden">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] font-semibold flex items-center gap-2"><Smartphone className="w-3.5 h-3.5" /> Cloud Terminals</p>
        <span className="text-[10px] text-muted-foreground">{terminals.length} terminal(s) · {demoMode ? "Demo" : "Live"}</span>
      </div>

      <div className="space-y-1.5">
        {terminals.length === 0 && <p className="text-[10px] text-muted-foreground">Nog geen terminals gekoppeld.</p>}
        {terminals.map((t) => {
          const lastSeenMs = t.last_seen_at ? Date.now() - new Date(t.last_seen_at).getTime() : null;
          const looksOffline =
            t.status !== "active" ||
            (lastSeenMs !== null && lastSeenMs > 1000 * 60 * 60);
          const highlighted = highlightId === t.id;
          return (
          <div
            key={t.id}
            ref={(el) => { cardRefs.current[t.id] = el; }}
            className={`rounded-lg border px-2 py-2 space-y-1.5 transition-colors ${highlighted ? "border-amber-500 bg-amber-500/10" : "border-border"}`}
          >
            <div className="flex items-start gap-2 min-w-0">
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="font-medium text-[11px] flex items-center gap-1 min-w-0">
                  {t.is_default && <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />}
                  <span className="truncate">{t.terminal_name}</span>
                </p>
                <div className="text-[10px] text-muted-foreground space-y-0.5 min-w-0">
                  <div className="min-w-0"><CopyableId label="ID:" value={t.terminal_id} /></div>
                  {t.source_terminal_id && <div className="min-w-0"><CopyableId label="Source:" value={t.source_terminal_id} /></div>}
                  {t.virtual_id && <div className="min-w-0"><CopyableId label="Virtual:" value={t.virtual_id} /></div>}
                  {t.serial_number && <div className="truncate">S/N: {t.serial_number}</div>}
                  {t.location_name && <div className="truncate">{t.location_name}</div>}
                  <div className="truncate">
                    Laatst gebruikt: {t.last_used_at ? new Date(t.last_used_at).toLocaleString("nl-NL") : "nooit"}
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${t.status === "active" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>{t.status}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${t.is_demo ? "bg-amber-500/15 text-amber-600" : "bg-primary/15 text-primary"}`}>{t.is_demo ? "Demo" : "Live"}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-wrap justify-end">
              {!t.is_default && (
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => makeDefault(t)}>
                  <Star className="w-3 h-3 mr-1" /> Standaard
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => toggle(t)}>
                <Power className="w-3 h-3 mr-1" /> {t.status === "active" ? "Uit" : "Aan"}
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-destructive hover:text-destructive" onClick={() => setToDelete(t)}>
                <Trash2 className="w-3 h-3 mr-1" /> Verwijderen
              </Button>
            </div>
            {looksOffline && !t.is_demo && (
              <WhyHint>Pinapparaat lijkt tijdelijk offline — controleer netwerk of herstart de terminal.</WhyHint>
            )}
          </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={tname} onChange={(e) => { setTname(e.target.value); setFormError(null); }} placeholder="Naam *" className="text-[11px] h-8 rounded-md border border-border bg-background px-2 w-full min-w-0" />
          <input value={tloc} onChange={(e) => setTloc(e.target.value)} placeholder="Locatie (optioneel)" className="text-[11px] h-8 rounded-md border border-border bg-background px-2 w-full min-w-0" />
          <input value={tid} onChange={(e) => { setTid(e.target.value); setFormError(null); }} placeholder="Terminal ID *" className={`text-[11px] h-8 rounded-md border bg-background px-2 w-full min-w-0 ${existingDup ? "border-amber-500" : "border-border"}`} />
          <input value={tsource} onChange={(e) => setTsource(e.target.value)} placeholder="Source Terminal ID" className="text-[11px] h-8 rounded-md border border-border bg-background px-2 w-full min-w-0" />
          <input value={tvirtual} onChange={(e) => setTvirtual(e.target.value)} placeholder="Virtual ID" className="text-[11px] h-8 rounded-md border border-border bg-background px-2 w-full min-w-0" />
          <input value={tserial} onChange={(e) => setTserial(e.target.value)} placeholder="Serienummer" className="text-[11px] h-8 rounded-md border border-border bg-background px-2 w-full min-w-0" />
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={tdefault} onChange={(e) => setTdefault(e.target.checked)} className="h-3.5 w-3.5" />
          <span className="break-words">Stel in als standaard pinapparaat voor {demoMode ? "demo" : "live"}</span>
        </label>
        {formError && (
          <p className="text-[11px] text-destructive break-words">{formError}</p>
        )}
        {!formError && existingDup && cleanTid && (
          <p className="text-[11px] text-amber-600 break-words">Deze terminal is al gekoppeld.</p>
        )}
        <Button type="button" size="sm" disabled={loading} onClick={add} className="w-full h-8 text-[11px]">
          <Plus className="w-3 h-3 mr-1" /> Terminal toevoegen
        </Button>
        <p className="text-[10px] text-muted-foreground break-words">Terminal ID en Source Terminal ID vind je in je Viva merchant portal onder POS / Cloud Terminals. Serienummer staat op de achterkant van het pinapparaat.</p>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => { if (!o) setToDelete(null); }}
        title="Terminal verwijderen?"
        description="Deze terminal wordt losgekoppeld van GlowSuite. Je kunt hem later opnieuw toevoegen."
        confirmLabel="Verwijderen"
        cancelLabel="Annuleren"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
