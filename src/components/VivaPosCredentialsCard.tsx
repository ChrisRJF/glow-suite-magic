import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, KeyRound, RefreshCw } from "lucide-react";

type HealthResult = {
  success: boolean;
  configured: boolean;
  environment: string;
  credential_kind: "pos" | "smart_checkout" | "none";
  account_host?: string;
  api_host?: string;
  has_source_code?: boolean;
  http_status?: number | null;
  code?: string;
  message?: string;
  token_length?: number;
};

const CRED_NAMES = [
  "VIVA_POS_CLIENT_ID",
  "VIVA_POS_CLIENT_SECRET",
  "VIVA_POS_SOURCE_CODE",
  "VIVA_POS_ENVIRONMENT",
];

export function VivaPosCredentialsCard() {
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<HealthResult | null>(null);

  const runCheck = async (showSpinner = true) => {
    if (showSpinner) setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("viva-terminal-health-check", { body: {} });
      if (error) throw error;
      setResult(data as HealthResult);
    } catch (e: any) {
      setResult({
        success: false,
        configured: false,
        environment: "unknown",
        credential_kind: "none",
        message: e?.message || "Kon health-check niet uitvoeren.",
      });
    } finally {
      setTesting(false);
      setLoading(false);
    }
  };

  useEffect(() => { runCheck(false); }, []);

  let badge: { cls: string; icon: any; label: string };
  if (!result || loading) {
    badge = { cls: "bg-muted text-muted-foreground border-border", icon: Loader2, label: "Bezig met controleren…" };
  } else if (!result.configured || result.credential_kind === "none") {
    badge = { cls: "bg-amber-50 text-amber-800 border-amber-200", icon: AlertTriangle, label: "⚠ Viva POS credentials ontbreken" };
  } else if (result.success && result.credential_kind === "pos") {
    badge = { cls: "bg-green-50 text-green-800 border-green-200", icon: CheckCircle2, label: "✓ Viva POS API verbonden" };
  } else if (result.success && result.credential_kind === "smart_checkout") {
    badge = { cls: "bg-amber-50 text-amber-800 border-amber-200", icon: AlertTriangle, label: "⚠ Smart Checkout fallback in gebruik" };
  } else {
    badge = { cls: "bg-red-50 text-red-800 border-red-200", icon: XCircle, label: "✗ Ongeldige Viva POS credentials" };
  }
  const BadgeIcon = badge.icon;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 max-w-full overflow-hidden">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <KeyRound className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm">Viva POS API credentials</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Aparte inloggegevens voor terminalbetalingen (ECR/POS). Smart Checkout blijft ongewijzigd.
          </p>
        </div>
      </div>

      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${badge.cls}`}>
        <BadgeIcon className={`w-4 h-4 shrink-0 ${loading ? "animate-spin" : ""}`} />
        <span className="truncate">{badge.label}</span>
      </div>

      {result && (
        <dl className="grid grid-cols-1 gap-y-1.5 mt-3 text-xs">
          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Environment</dt><dd className="font-medium truncate">{result.environment}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Credential type</dt><dd className="font-medium truncate">{result.credential_kind === "pos" ? "Dedicated POS" : result.credential_kind === "smart_checkout" ? "Smart Checkout (fallback)" : "Geen"}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Source code</dt><dd className="font-medium">{result.has_source_code ? "Aanwezig" : "Ontbreekt"}</dd></div>
          {result.http_status != null && (
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">HTTP status</dt><dd className="font-medium">{result.http_status}</dd></div>
          )}
          {result.message && (
            <div className="mt-1 rounded-md bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground break-words">
              {result.message}
            </div>
          )}
        </dl>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mt-4">
        <Button
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => runCheck(true)}
          disabled={testing}
        >
          {testing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
          Test verbinding
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
        Credentials worden alleen opgeslagen als beveiligde Edge Function secrets ({CRED_NAMES.join(", ")}).
        Vraag de Lovable beheerder om ze in te voeren via het beveiligde secret-formulier; ze worden nooit in de browser, database of code opgeslagen.
      </p>
    </div>
  );
}

export function useVivaPosReady() {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.functions.invoke("viva-terminal-health-check", { body: {} })
      .then(({ data }) => {
        const r = data as HealthResult | null;
        setReady(Boolean(r && r.configured && r.success && r.credential_kind === "pos"));
      })
      .catch(() => setReady(false));
  }, []);
  return ready;
}
