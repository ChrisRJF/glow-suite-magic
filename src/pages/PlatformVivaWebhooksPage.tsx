import { useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { usePlatformAccess } from "@/hooks/usePlatformAccess";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

// Temporary admin-only page. UI gate is a hint; the server checks admin list, AAL2 and confirm word.
const CONFIRM = "register_live_isv_webhooks_8193_8194";
const LABEL: Record<string, string> = { registered: "Geregistreerd", already_registered: "Was al geregistreerd", failed: "Mislukt" };

export default function PlatformVivaWebhooksPage() {
  const access = usePlatformAccess();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<{ events?: Record<string, string>; error?: string; list?: string } | null>(null);

  if (access.loading) return <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!access.owner) return <Navigate to="/" replace />;

  const run = async () => {
    if (busy || done) return;
    if (!window.confirm("Webhooks 8193 en 8194 eenmalig bij Viva LIVE registreren?")) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("register-viva-isv-live-webhooks", { body: { confirm: CONFIRM } });
    let body: any = data;
    if (error) { try { body = await (error as any).context?.json?.(); } catch { body = null; } }
    const safe = { events: body?.events, error: typeof body?.error === "string" ? body.error : error ? "request_failed" : undefined, list: body?.list };
    setResult(safe);
    if (safe.events) setDone(true);
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-xl p-6">
      <Card className="space-y-4 p-6">
        <h1 className="text-xl font-semibold">Viva LIVE webhooks registreren</h1>
        <p className="text-sm text-muted-foreground">Eenmalige beheeractie voor events 8193 en 8194. Vereist inloggen met tweestapsverificatie. Druk maar één keer.</p>
        {!access.aal2 && <p className="text-sm text-destructive">Log opnieuw in met je tweestapscode om door te gaan.</p>}
        <Button onClick={run} disabled={busy || done || !access.aal2}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Registreer 8193 en 8194
        </Button>
        {result && (
          <div className="space-y-1 text-sm" aria-live="polite">
            {result.events && Object.entries(result.events).map(([ev, s]) => <p key={ev}>Event {ev}: {LABEL[s] ?? s}</p>)}
            {result.error && <p className="text-destructive">Niet gelukt: {result.error}</p>}
            {result.list === "unsupported" && <p className="text-muted-foreground">Viva kon bestaande registraties niet tonen. Niet opnieuw uitvoeren.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
