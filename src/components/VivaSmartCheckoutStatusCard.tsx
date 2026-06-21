import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, ShoppingCart, RefreshCw } from "lucide-react";

type HealthResult = {
  success: boolean;
  credential_valid: boolean;
  environment: string;
  has_client_id: boolean;
  has_client_secret: boolean;
  has_source_code: boolean;
  source_code?: string | null;
  account_host?: string;
  api_host?: string;
  http_status?: number | null;
  code?: string;
  message?: string;
  viva_error?: unknown;
};

export function VivaSmartCheckoutStatusCard() {
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<HealthResult | null>(null);

  const runCheck = async (showSpinner = true) => {
    if (showSpinner) setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("viva-smart-checkout-health-check", { body: {} });
      if (error) throw error;
      setResult(data as HealthResult);
    } catch (e: any) {
      setResult({
        success: false,
        credential_valid: false,
        environment: "unknown",
        has_client_id: false,
        has_client_secret: false,
        has_source_code: false,
        message: e?.message || "Kon health-check niet uitvoeren.",
      });
    } finally {
      setTesting(false);
      setLoading(false);
    }
  };

  useEffect(() => { runCheck(false); }, []);

  const missing = result && (!result.has_client_id || !result.has_client_secret || !result.has_source_code);

  let badge: { cls: string; icon: any; label: string };
  if (!result || loading) {
    badge = { cls: "bg-muted text-muted-foreground border-border", icon: Loader2, label: "Bezig met controleren…" };
  } else if (missing) {
    badge = { cls: "bg-amber-50 text-amber-800 border-amber-200", icon: AlertTriangle, label: "⚠ Smart Checkout credentials ontbreken" };
  } else if (result.success && result.credential_valid) {
    badge = { cls: "bg-green-50 text-green-800 border-green-200", icon: CheckCircle2, label: "✓ Smart Checkout verbonden" };
  } else {
    badge = { cls: "bg-red-50 text-red-800 border-red-200", icon: XCircle, label: "✗ Smart Checkout credentials ongeldig" };
  }
  const BadgeIcon = badge.icon;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 max-w-full overflow-hidden">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <ShoppingCart className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm">Smart Checkout status</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Controleert de Viva Smart Checkout API credentials (online betalingen).
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
          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Client ID</dt><dd className="font-medium">{result.has_client_id ? "Aanwezig" : "Ontbreekt"}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Client secret</dt><dd className="font-medium">{result.has_client_secret ? "Aanwezig" : "Ontbreekt"}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Source code</dt><dd className="font-medium truncate">{result.source_code || (result.has_source_code ? "Aanwezig" : "Ontbreekt")}</dd></div>
          {result.account_host && (
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Account host</dt><dd className="font-medium truncate">{result.account_host.replace(/^https?:\/\//, "")}</dd></div>
          )}
          {result.http_status != null && (
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">HTTP status</dt><dd className="font-medium">{result.http_status}</dd></div>
          )}
          {result.message && (
            <div className="mt-1 rounded-md bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground break-words">
              {result.message}
            </div>
          )}
          {result.viva_error != null && (
            <pre className="mt-1 rounded-md bg-muted/40 px-2 py-1.5 text-[10px] text-muted-foreground overflow-auto max-h-32">
{typeof result.viva_error === "string" ? result.viva_error : JSON.stringify(result.viva_error, null, 2)}
            </pre>
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
          Test Smart Checkout
        </Button>
      </div>
    </div>
  );
}
