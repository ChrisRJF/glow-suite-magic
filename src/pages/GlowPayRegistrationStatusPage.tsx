import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { glowpayPaymentStatus, type PayStatus } from "@/lib/glowpayOnboardingStatus";
import { trustedVivaUrl } from "@/lib/vivaOnboardingUrl";
import { Check, Clock, AlertTriangle, Loader2, LogIn, ExternalLink, ShieldCheck } from "lucide-react";
import glowpayLogo from "@/assets/glowpay/glowpay-logo.png.asset.json";

// Return page after the Viva registration flow. It never assumes approval:
// status comes only from the user's own RLS-filtered merchant row
// (is_demo = false). No tenant or account IDs are trusted from the URL,
// no Edge Functions are called and no account is ever created here.

type LoadState = "loading" | "ready" | "error";

const STATUS_CONTENT: Record<PayStatus, { icon: any; tone: string; title: string; text: string }> = {
  not_started: {
    icon: Clock,
    tone: "text-muted-foreground",
    title: "Registratie nog niet gestart",
    text: "Er is nog geen GlowPay-account gekoppeld. Je kunt GlowSuite ondertussen gewoon gebruiken.",
  },
  pending: {
    icon: Clock,
    tone: "text-muted-foreground",
    title: "Verificatie in behandeling",
    text: "Viva controleert je bedrijfsgegevens. Dat kan even duren. Je hoeft niets te doen en kunt GlowSuite ondertussen gebruiken.",
  },
  action_needed: {
    icon: AlertTriangle,
    tone: "text-amber-600",
    title: "Actie nodig bij Viva",
    text: "Viva heeft nog aanvullende gegevens nodig. Rond de verificatie af bij Viva om betalingen te kunnen ontvangen.",
  },
  active: {
    icon: Check,
    tone: "text-success",
    title: "GlowPay is actief",
    text: "Je betaalaccount is goedgekeurd en betalingen zijn beschikbaar in GlowSuite.",
  },
};

export default function GlowPayRegistrationStatusPage() {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<LoadState>("loading");
  const [status, setStatus] = useState<PayStatus | null>(null);
  const [continueUrl, setContinueUrl] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setState("ready"); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase as any)
        .from("glowpay_connected_merchants")
        .select("viva_account_id, viva_merchant_id, onboarding_status, kyc_status, online_payments_enabled, viva_source_code, onboarding_url, is_demo")
        .eq("user_id", user.id)
        .eq("is_demo", false)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setState("error");
        setStatus(null);
      } else {
        setState("ready");
        setStatus(glowpayPaymentStatus(data ?? null));
        setContinueUrl(trustedVivaUrl(data?.onboarding_url));
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, authLoading]);

  const content = status ? STATUS_CONTENT[status] : null;
  const Icon = content?.icon;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <img
            src={glowpayLogo.url}
            alt="GlowPay"
            width={1470}
            height={335}
            className="h-auto w-40 max-w-full rounded-md object-contain"
          />
          <h1 className="text-2xl font-bold tracking-tight">Registratie bij Viva</h1>
          <p className="text-sm text-muted-foreground">
            De registratie en verificatie van je betaalaccount gebeuren bij onze betaalpartner Viva.
            Terugkeren naar GlowSuite betekent niet automatisch dat de verificatie al is afgerond.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          {authLoading || state === "loading" ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Status ophalen…
            </div>
          ) : !user ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                Log in om de status van je GlowPay-registratie te bekijken.
              </p>
              <Button asChild variant="gradient" className="w-full">
                <Link to="/login"><LogIn className="w-4 h-4" /> Inloggen</Link>
              </Button>
            </div>
          ) : state === "error" ? (
            <div className="space-y-3 text-center">
              <p className="text-sm font-medium">Status tijdelijk onbekend</p>
              <p className="text-xs text-muted-foreground">
                We kunnen je registratiestatus nu niet ophalen. Probeer het later opnieuw.
                Er is niets misgegaan met je gegevens.
              </p>
            </div>
          ) : content && Icon ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                  <Icon className={`w-5 h-5 ${content.tone}`} />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">{content.title}</p>
                  <p className="text-sm text-muted-foreground mt-1">{content.text}</p>
                </div>
              </div>
              {continueUrl && status !== "active" && (
                <Button asChild variant="outline" className="w-full">
                  <a href={continueUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4" /> Verder bij Viva
                  </a>
                </Button>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-secondary/40 border border-border/50 text-xs text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
          <span>
            GlowSuite vraagt nooit om je Viva-inloggegevens of verificatiedocumenten.
            Die deel je alleen rechtstreeks met Viva.
          </span>
        </div>

        <div className="text-center">
          <Button asChild variant="ghost" size="sm">
            <Link to="/">Terug naar GlowSuite</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
