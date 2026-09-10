import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ClipboardList, Lock } from "lucide-react";
import { useDossierAccess } from "@/hooks/useDossierAccess";
import type { TreatmentField } from "./TreatmentTemplatesManager";

interface RecordRow {
  id: string;
  status: string;
  values: Record<string, unknown>;
  template_snapshot: { fields?: TreatmentField[]; title?: string } | null;
  template_version: number;
  completed_at: string | null;
  created_at: string;
}

/** Read-only treatment history in the customer dossier. */
export function CustomerTreatmentHistory({ customerId }: { customerId: string }) {
  const { canViewContent, loading } = useDossierAccess();
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !canViewContent) return;
    supabase
      .from("treatment_records")
      .select("id, status, values, template_snapshot, template_version, completed_at, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .then(({ data }) => setRecords((data as unknown as RecordRow[]) || []));
  }, [loading, canViewContent, customerId]);

  if (loading || !canViewContent) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-primary" /> Behandelverslagen
      </h4>
      {records.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nog geen behandelverslagen.</p>
      ) : (
        records.map((r) => {
          const fields = r.template_snapshot?.fields ?? [];
          const date = new Date(r.completed_at || r.created_at);
          return (
            <div key={r.id} className="rounded-xl border border-border">
              <button className="w-full p-3 text-left" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                <p className="text-sm font-medium text-foreground">
                  {r.template_snapshot?.title || "Behandelverslag"} · versie {r.template_version}
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {date.toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}
                  {r.status === "completed" ? (
                    <>
                      · <Lock className="h-3 w-3" /> afgerond
                    </>
                  ) : (
                    " · concept"
                  )}
                </p>
              </button>
              {openId === r.id && (
                <div className="space-y-2 border-t border-border p-3">
                  {fields
                    .filter((f) => f.type !== "info_text")
                    .map((f) => (
                      <div key={f.key}>
                        <p className="text-xs text-muted-foreground">{f.label}</p>
                        <p className="text-sm text-foreground whitespace-pre-wrap">
                          {Array.isArray(r.values?.[f.key])
                            ? (r.values[f.key] as string[]).join(", ")
                            : String(r.values?.[f.key] ?? "-")}
                        </p>
                      </div>
                    ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
