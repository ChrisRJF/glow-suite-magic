import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ChevronDown } from "lucide-react";

interface Props {
  customerId: string;
  /** True when the viewer may see dossier content (answers, labels). */
  canViewContent: boolean;
  /** Number of open attention points from the batched dossier status. */
  openAlerts: number;
}

/**
 * Compact "Aandachtspunt aanwezig" hint at the top of an appointment.
 * Reception only sees that there is one, never what it says.
 */
export function AppointmentAlertBanner({ customerId, canViewContent, openAlerts }: Props) {
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open || !canViewContent || labels) return;
    (async () => {
      const { data } = await supabase
        .from("customer_alerts")
        .select("id, label, created_at")
        .eq("customer_id", customerId)
        .eq("review_status", "unreviewed")
        .order("created_at", { ascending: false })
        .limit(10);
      setLabels(((data as { label: string }[]) || []).map((a) => a.label));
    })();
  }, [open, canViewContent, customerId, labels]);

  if (openAlerts <= 0) return null;

  const text = "Aandachtspunt aanwezig";

  if (!canViewContent) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {text}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-sm font-medium"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="flex-1">{text}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="mt-2 space-y-1 text-xs">
          {labels === null ? (
            <li>Laden...</li>
          ) : labels.length === 0 ? (
            <li>Geen details beschikbaar.</li>
          ) : (
            labels.map((l, i) => <li key={i}>{l}</li>)
          )}
        </ul>
      )}
    </div>
  );
}
