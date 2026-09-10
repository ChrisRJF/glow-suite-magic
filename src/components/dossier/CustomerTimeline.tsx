import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Calendar, Camera, FileText, History, Stethoscope } from "lucide-react";
import { useDossierAccess } from "@/hooks/useDossierAccess";

interface TimelineRow {
  occurred_at: string;
  kind: string;
  category: string;
  label: string;
  detail_id: string | null;
  meta: Record<string, unknown> | null;
}

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Alles" },
  { value: "forms", label: "Formulieren" },
  { value: "treatments", label: "Behandelingen" },
  { value: "photos", label: "Foto's" },
  { value: "alerts", label: "Aandachtspunten" },
];

const ICON: Record<string, typeof FileText> = {
  forms: FileText,
  treatments: Stethoscope,
  photos: Camera,
  alerts: AlertTriangle,
};

const PAGE = 25;

export function CustomerTimeline({ customerId }: { customerId: string }) {
  const { canViewStatus, loading: accessLoading } = useDossierAccess();
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [filter, setFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async (nextOffset: number, replace: boolean) => {
    setLoading(true);
    const { data } = await supabase.rpc("customer_dossier_timeline", {
      _customer_id: customerId,
      _limit: PAGE,
      _offset: nextOffset,
    });
    const list = (data as unknown as TimelineRow[]) || [];
    setRows((prev) => (replace ? list : [...prev, ...list]));
    setDone(list.length < PAGE);
    setOffset(nextOffset);
    setLoading(false);
  };

  useEffect(() => {
    if (!accessLoading && canViewStatus) load(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessLoading, canViewStatus, customerId]);

  if (accessLoading || !canViewStatus) return null;

  const visible = filter === "all" ? rows : rows.filter((r) => r.category === filter);

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <History className="h-4 w-4 text-primary" /> Tijdlijn
      </h4>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full border px-3 py-1 text-xs ${
              filter === f.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nog niets vastgelegd voor deze klant.</p>
      ) : (
        <div className="space-y-4">
          {groupByMonth(visible).map((group) => (
            <div key={group.key} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</p>
              <ol className="space-y-2">
                {group.rows.map((r, i) => {
                  const Icon = ICON[r.category] ?? Calendar;
                  return (
                    <li key={`${r.kind}-${r.detail_id}-${i}`} className="flex items-start gap-2 rounded-xl border border-border p-3">
                      <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-foreground">{r.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(r.occurred_at).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}

      {!done && (
        <Button variant="outline" size="sm" disabled={loading} onClick={() => load(offset + PAGE, false)}>
          {loading ? "Laden..." : "Meer tonen"}
        </Button>
      )}
    </div>
  );
}
