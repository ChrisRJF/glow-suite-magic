import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDossierAccess } from "@/hooks/useDossierAccess";

interface Entry { id: string; kind: string; occurred_on: string; occurred_time: string | null; service_name: string | null; employee_name: string | null; note: string | null }

/** Read-only imported history. Never treated as signed or completed GlowSuite records. */
export function HistoricalEntries({ customerId }: { customerId: string }) {
  const { canViewContent, loading } = useDossierAccess();
  const [rows, setRows] = useState<Entry[]>([]);
  useEffect(() => {
    if (loading || !canViewContent) return;
    (supabase as any).from("historical_dossier_entries")
      .select("id, kind, occurred_on, occurred_time, service_name, employee_name, note")
      .eq("customer_id", customerId).order("occurred_on", { ascending: false })
      .then(({ data }: { data: Entry[] | null }) => setRows(data || []));
  }, [loading, canViewContent, customerId]);
  if (loading || !canViewContent || rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold flex items-center gap-2"><History className="h-4 w-4 text-muted-foreground" /> Historie (geïmporteerd)</h4>
      {rows.map((r) => (
        <div key={r.id} className="rounded-xl border border-dashed border-border p-3">
          <p className="text-sm font-medium">
            {r.kind === "appointment" ? "Afspraak" : "Verslag"} · {new Date(r.occurred_on + "T00:00:00").toLocaleDateString("nl-NL", { dateStyle: "medium" })}
            {r.occurred_time ? ` ${r.occurred_time.slice(0, 5)}` : ""}{r.service_name ? ` · ${r.service_name}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">Geïmporteerd uit Salonized · alleen-lezen{r.employee_name ? ` · ${r.employee_name}` : ""}</p>
          {r.note && <p className="text-sm mt-1 whitespace-pre-wrap">{r.note}</p>}
        </div>
      ))}
    </div>
  );
}
