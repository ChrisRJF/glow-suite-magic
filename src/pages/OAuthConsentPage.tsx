import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { GlowSuiteLogo } from "@/components/GlowSuiteLogo";
import { Loader2, ShieldCheck } from "lucide-react";

type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};

function oauth(): OAuthNamespace {
  return (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;
}

export default function OAuthConsentPage() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Geen autorisatieverzoek gevonden.");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error: detailsError } = await oauth().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (detailsError) {
        setError(detailsError.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error: decisionError } = approve
      ? await oauth().approveAuthorization(authorizationId)
      : await oauth().denyAuthorization(authorizationId);
    if (decisionError) {
      setBusy(false);
      setError(decisionError.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("De autorisatieserver gaf geen doorverwijzing terug.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "deze app";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="glass-card p-8 max-w-md w-full">
        <div className="flex justify-center mb-6">
          <GlowSuiteLogo />
        </div>
        {error ? (
          <div className="text-center">
            <h1 className="text-xl font-semibold mb-2">Verzoek kon niet worden geladen</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : !details ? (
          <div className="flex flex-col items-center gap-3 py-6 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-sm">Autorisatieverzoek laden...</p>
          </div>
        ) : (
          <div>
            <div className="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-xl font-semibold text-center mb-2">
              {clientName} koppelen aan je account
            </h1>
            <p className="text-sm text-muted-foreground text-center mb-6">
              {clientName} krijgt toegang tot je GlowSuite gegevens namens jou. Je kunt de koppeling later
              intrekken.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" disabled={busy} onClick={() => decide(false)}>
                Weigeren
              </Button>
              <Button variant="gradient" className="flex-1" disabled={busy} onClick={() => decide(true)}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Toestaan"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
