// TEMPORARY: one-click read-only Viva ISV commission check for the platform owner (AAL2). Remove after use.
// Access is enforced server-side; the button only shows when the server confirms eligibility.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { isPreviewHost } from "@/components/IsvDemoOrderButton";

const DONE_KEY = "glowsuite.isvCommissionCheck.done";

type Result = { ok: boolean; http_status?: number; identity?: { order_code_match: boolean; status_id: string | null }; field_names?: string[]; financial_fields?: Record<string, unknown>; stage?: string };

export function IsvCommissionCheckButton() {
  const [eligible, setEligible] = useState(false);
  const [used, setUsed] = useState(() => localStorage.getItem(DONE_KEY) === "1");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isPreviewHost()) return;
    (async () => {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (data?.currentLevel !== "aal2") return;
      const r = await supabase.functions.invoke("viva-isv-tx-check", { body: { mode: "eligibility" } });
      if (r.data?.eligible === true) setEligible(true);
    })().catch(() => {});
  }, []);

  if (!isPreviewHost() || !eligible) return null;

  const run = async () => {
    if (used || busy) return;
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("viva-isv-tx-check", { body: {} });
      if (error || !data) setErr("De controle is mislukt. Probeer niet opnieuw; laat het eerst controleren.");
      else {
        setResult(data as Result);
        if ((data as Result).ok) { localStorage.setItem(DONE_KEY, "1"); setUsed(true); }
      }
    } catch { setErr("Geen antwoord ontvangen. Probeer niet opnieuw; laat het eerst controleren."); }
    finally { setBusy(false); }
  };

  return (
    <div className="glass-card space-y-3 p-5">
      <h3 className="text-sm font-semibold">Viva ISV-commissiecontrole (tijdelijk)</h3>
      <p className="text-sm text-muted-foreground">Leest één vaste demotransactie bij Viva. Wijzigt niets.</p>
      <Button onClick={run} disabled={used || busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Controleer ISV-commissie
      </Button>
      {used && !result && <p className="text-sm text-muted-foreground">Deze controle is al uitgevoerd.</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {result && (
        <div className="space-y-1 text-sm">
          <p>HTTP-status: {result.http_status ?? "-"}{result.stage ? ` (${result.stage})` : ""}</p>
          {result.identity && <p>Order klopt: {result.identity.order_code_match ? "ja" : "nee"} · Status: {result.identity.status_id ?? "-"}</p>}
          <p className="font-medium">Financiële velden:</p>
          <ul className="list-disc pl-5">
            {Object.entries(result.financial_fields ?? {}).map(([k, v]) => <li key={k}><code>{k}</code>: {String(v)}</li>)}
            {!Object.keys(result.financial_fields ?? {}).length && <li>Geen</li>}
          </ul>
          <p className="text-muted-foreground break-words">Alle veldnamen: {(result.field_names ?? []).join(", ") || "-"}</p>
        </div>
      )}
    </div>
  );
}
