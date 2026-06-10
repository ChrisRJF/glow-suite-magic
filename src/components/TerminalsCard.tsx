import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { toast } from "sonner";
import { Power, Plus, Smartphone, Star } from "lucide-react";
import { WhyHint } from "@/components/WhyHint";

type Terminal = {
  id: string; terminal_id: string; terminal_name: string;
  location_name: string | null; status: string; last_seen_at: string | null;
  last_used_at: string | null; is_demo: boolean; is_default: boolean;
  source_terminal_id: string | null; virtual_id: string | null; serial_number: string | null;
};

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

  const load = async () => {
    const { data } = await supabase.from("viva_terminals").select("*").order("is_default", { ascending: false }).order("created_at", { ascending: false });
    setTerminals((data as any) || []);
  };
  useEffect(() => { load(); }, [demoMode]);

  const add = async () => {
    if (!user || !tid.trim() || !tname.trim()) { toast.error("Terminal ID en naam zijn vereist"); return; }
    setLoading(true);
    // If marking as default, clear other defaults first (within same demo/live scope)
    if (tdefault) {
      await (supabase.from("viva_terminals") as any).update({ is_default: false }).eq("user_id", user.id).eq("is_demo", demoMode);
    }
    const { error } = await supabase.from("viva_terminals").insert({
      user_id: user.id, is_demo: demoMode, terminal_id: tid.trim(), terminal_name: tname.trim(),
      location_name: tloc.trim() || null, status: "active",
      source_terminal_id: tsource.trim() || null,
      virtual_id: tvirtual.trim() || null,
      serial_number: tserial.trim() || null,
      is_default: tdefault,
    } as any);
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setTid(""); setTname(""); setTloc(""); setTsource(""); setTvirtual(""); setTserial(""); setTdefault(false);
    toast.success("Terminal toegevoegd");
    load();
  };

  const toggle = async (t: Terminal) => {
    const next = t.status === "active" ? "inactive" : "active";
    const { error } = await supabase.from("viva_terminals").update({ status: next }).eq("id", t.id);
    if (error) toast.error(error.message); else load();
  };

  const makeDefault = async (t: Terminal) => {
    if (!user) return;
    await (supabase.from("viva_terminals") as any).update({ is_default: false }).eq("user_id", user.id).eq("is_demo", t.is_demo);
    const { error } = await (supabase.from("viva_terminals") as any).update({ is_default: true }).eq("id", t.id);
    if (error) toast.error(error.message); else { toast.success("Standaard pinapparaat ingesteld"); load(); }
  };

  const remove = async (t: Terminal) => {
    if (!confirm(`Terminal "${t.terminal_name}" verwijderen?`)) return;
    const { error } = await supabase.from("viva_terminals").delete().eq("id", t.id);
    if (error) toast.error(error.message); else load();
  };

  return (
    <div className="rounded-xl border border-border bg-background/60 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold flex items-center gap-2"><Smartphone className="w-3.5 h-3.5" /> Cloud Terminals</p>
        <span className="text-[10px] text-muted-foreground">{terminals.length} terminal(s) · {demoMode ? "Demo" : "Live"}</span>
      </div>

      <div className="space-y-1.5">
        {terminals.length === 0 && <p className="text-[10px] text-muted-foreground">Nog geen terminals gekoppeld.</p>}
        {terminals.map((t) => {
          const lastSeenMs = t.last_seen_at ? Date.now() - new Date(t.last_seen_at).getTime() : null;
          const looksOffline =
            t.status !== "active" ||
            (lastSeenMs !== null && lastSeenMs > 1000 * 60 * 60); // >1h
          return (
          <div key={t.id} className="rounded-lg border border-border px-2 py-1.5 space-y-1">
            <div className="flex items-center gap-2 text-[11px]">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate flex items-center gap-1">
                  {t.is_default && <Star className="w-3 h-3 text-amber-500 fill-amber-500" />}
                  {t.terminal_name} <span className="text-muted-foreground font-normal">· {t.terminal_id}</span>
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {t.location_name || "—"} · {t.serial_number ? `S/N ${t.serial_number} · ` : ""}laatst gebruikt: {t.last_used_at ? new Date(t.last_used_at).toLocaleString("nl-NL") : "nooit"}
                </p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${t.status === "active" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>{t.status}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${t.is_demo ? "bg-amber-500/15 text-amber-600" : "bg-primary/15 text-primary"}`}>{t.is_demo ? "Demo" : "Live"}</span>
              {!t.is_default && (
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => makeDefault(t)} title="Maak standaard"><Star className="w-3 h-3" /></Button>
              )}
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => toggle(t)} title="In/uitschakelen"><Power className="w-3 h-3" /></Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => remove(t)}>×</Button>
            </div>
            {looksOffline && !t.is_demo && (
              <WhyHint>Pinapparaat lijkt tijdelijk offline — controleer netwerk of herstart de terminal.</WhyHint>
            )}
          </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input value={tname} onChange={(e) => setTname(e.target.value)} placeholder="Naam" className="text-[11px] h-8 rounded-md border border-border bg-background px-2" />
        <input value={tloc} onChange={(e) => setTloc(e.target.value)} placeholder="Locatie (optioneel)" className="text-[11px] h-8 rounded-md border border-border bg-background px-2" />
        <input value={tid} onChange={(e) => setTid(e.target.value)} placeholder="Terminal ID" className="text-[11px] h-8 rounded-md border border-border bg-background px-2" />
        <input value={tsource} onChange={(e) => setTsource(e.target.value)} placeholder="Source Terminal ID (optioneel)" className="text-[11px] h-8 rounded-md border border-border bg-background px-2" />
        <input value={tvirtual} onChange={(e) => setTvirtual(e.target.value)} placeholder="Virtual ID (optioneel)" className="text-[11px] h-8 rounded-md border border-border bg-background px-2" />
        <input value={tserial} onChange={(e) => setTserial(e.target.value)} placeholder="Serienummer (optioneel)" className="text-[11px] h-8 rounded-md border border-border bg-background px-2" />
        <label className="col-span-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={tdefault} onChange={(e) => setTdefault(e.target.checked)} className="h-3.5 w-3.5" />
          Stel in als standaard pinapparaat voor {demoMode ? "demo" : "live"}
        </label>
      </div>
      <Button type="button" size="sm" disabled={loading} onClick={add} className="w-full h-8 text-[11px]">
        <Plus className="w-3 h-3 mr-1" /> Terminal toevoegen
      </Button>
      <p className="text-[10px] text-muted-foreground">Terminal ID en Source Terminal ID vind je in je Viva merchant portal onder POS / Cloud Terminals. Serienummer staat op de achterkant van het pinapparaat.</p>
    </div>
  );
}
