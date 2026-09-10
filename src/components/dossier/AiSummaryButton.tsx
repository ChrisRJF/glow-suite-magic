import { useRef, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useDossierAccess } from "@/hooks/useDossierAccess";

interface Props {
  label: string;
  action: "dossier_summary" | "appointment_prep" | "record_summary";
  customerId?: string;
  appointmentId?: string | null;
  recordId?: string | null;
}

/**
 * P4.5: on-demand AI summary. Only fires on an explicit click, never on mount,
 * and never writes anything back to the dossier.
 */
export function AiSummaryButton({ label, action, customerId, appointmentId, recordId }: Props) {
  const { canViewContent } = useDossierAccess();
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  if (!canViewContent) return null;

  const run = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const { data, error } = await supabase.functions.invoke("dossier-ai", {
        body: { action, customer_id: customerId, appointment_id: appointmentId, record_id: recordId },
      });
      const text = (data as { summary?: string })?.summary;
      if (error || !text) setFailed(true);
      else setSummary(text);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  };

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={run} disabled={loading}>
        {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
        {loading ? "Bezig" : label}
      </Button>

      {failed && (
        <p className="rounded-xl border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          Samenvatting kon niet worden gemaakt. De originele dossierinformatie blijft beschikbaar.
        </p>
      )}

      {summary && (
        <div className="space-y-1 rounded-xl border border-border p-3">
          <p className="text-xs font-medium text-foreground">AI-samenvatting</p>
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">{summary}</p>
          <p className="text-[11px] text-muted-foreground">
            Controleer altijd de originele dossierinformatie. Geen diagnose of behandeladvies.
          </p>
        </div>
      )}
    </div>
  );
}
