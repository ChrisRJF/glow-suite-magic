import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { X, Users, ShieldCheck } from "lucide-react";
import { CUSTOMER_LINKED_TABLES, findDuplicateGroups, type DupCustomer } from "@/lib/customerDuplicates";

type Counts = Record<string, Record<string, number | null>>; // customerId -> table -> count (null = niet zichtbaar)

/** Read-only review. Never deletes, merges or edits customers. Data comes from the
 *  already-loaded, tenant-scoped (RLS) customer list; link counts are head-only reads. */
export function DuplicateCustomersReview({ customers, onClose }: { customers: DupCustomer[]; onClose: () => void }) {
  const groups = useMemo(() => findDuplicateGroups(customers), [customers]);
  const [open, setOpen] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts>({});
  const [loading, setLoading] = useState(false);

  const loadCounts = async (ids: string[]) => {
    setLoading(true);
    const next: Counts = {};
    for (const id of ids) {
      next[id] = {};
      await Promise.all(CUSTOMER_LINKED_TABLES.map(async ({ table }) => {
        const { count, error } = await (supabase.from(table as any) as any)
          .select("customer_id", { count: "exact", head: true }).eq("customer_id", id);
        next[id][table] = error ? null : count ?? 0;
      }));
    }
    setCounts((c) => ({ ...c, ...next }));
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-card p-5 w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-lg font-semibold">Mogelijke dubbele klanten</h3>
            <p className="text-xs text-muted-foreground mt-1">Alleen een voorbeeldweergave. Er wordt niets samengevoegd of verwijderd. Herkend op hetzelfde e-mailadres of telefoonnummer; alleen een gelijke naam telt niet.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary" aria-label="Sluiten"><X className="w-4 h-4" /></button>
        </div>
        {groups.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">Geen mogelijke dubbele klanten gevonden.</p> : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{groups.length} groepen gevonden</p>
            {groups.map((g) => (
              <div key={g.key} className="rounded-xl border border-border p-3">
                <button className="w-full text-left flex items-center justify-between gap-2"
                  onClick={() => { const n = open === g.key ? null : g.key; setOpen(n); if (n) loadCounts(g.customers.map((c) => c.id)); }}>
                  <span className="flex items-center gap-2 text-sm font-medium"><Users className="w-4 h-4" />{g.customers.length} klanten · {g.reasons.join(" · ")}</span>
                  <span className="text-xs text-primary">{open === g.key ? "Verbergen" : "Bekijken"}</span>
                </button>
                {open === g.key && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {g.customers.map((c) => {
                      const cc = counts[c.id] ?? {};
                      const linked = CUSTOMER_LINKED_TABLES.filter((t) => (cc[t.table] ?? 0) > 0 || cc[t.table] === null);
                      return (
                        <div key={c.id} className="rounded-lg bg-secondary/50 p-3 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold truncate">{c.name || "Naamloos"}</span>
                            {c.id === g.suggestedKeepId && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/15 text-primary inline-flex items-center gap-1"><ShieldCheck className="w-3 h-3" />Oudste record</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 break-all">{c.email || "Geen e-mail"} · {c.phone || "Geen telefoon"}</p>
                          {c.created_at && <p className="text-xs text-muted-foreground">Aangemaakt {new Date(c.created_at).toLocaleDateString("nl-NL")}</p>}
                          {c.notes && <p className="text-xs mt-1">Notities: {c.notes}</p>}
                          <p className="text-xs font-medium mt-2">Gekoppelde gegevens (blijven behouden):</p>
                          {loading && !counts[c.id] ? <p className="text-xs text-muted-foreground">Laden...</p> :
                            linked.length === 0 ? <p className="text-xs text-muted-foreground">Geen gekoppelde gegevens</p> :
                            <ul className="text-xs mt-1 space-y-0.5">{linked.map((t) => <li key={t.table}>{t.label}: {cc[t.table] === null ? "niet zichtbaar voor jouw rol" : cc[t.table]}</li>)}</ul>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end"><Button variant="outline" onClick={onClose}>Sluiten</Button></div>
      </div>
    </div>
  );
}
