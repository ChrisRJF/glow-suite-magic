import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import type { PayStatus } from "@/lib/glowpayOnboardingStatus";
import { registrationView, visibleView, type RegistrationView } from "@/lib/glowpayRegistrationStatus";
import { trustedVivaUrl } from "@/lib/vivaOnboardingUrl";
import { Check, Clock, AlertTriangle, Loader2, LogIn, ExternalLink, ShieldCheck, HelpCircle } from "lucide-react";
import glowpayLogo from "@/assets/glowpay/glowpay-logo.png.asset.json";
import { GlowSuiteLogo } from "@/components/GlowSuiteLogo";

// Return page after the Viva registration flow. It never assumes approval:
// status comes only from the user's own RLS-filtered merchant row
// (is_demo = false). No tenant or account IDs are trusted from the URL,
// no Edge Functions are called and no account is ever created here.
// A missing row is never shown as "not started": local persistence can lag
// behind a successful Viva signup, so that case stays honestly unknown.

const STATUS_CONTENT: Record<PayStatus, { icon: any; tone: string; title: string; text: string }> = {
  not_started: {
    icon: Clock,
    tone: "text-muted-foreground",
    title: "Registratie nog niet gestart",
    text: "Je GlowPay-account is nog niet aangemaakt. Je kunt GlowSuite ondertussen gewoon gebruiken.",
  },
  pending: {
    icon: Clock,
    tone: "text-muted-foreground",
    title: "Verificatie in behandeling",
    text: "Je registratie is nog niet bevestigd als afgerond. Controleer bij Viva of je nog stappen moet afronden, zoals het koppelen van je account of de verificatie. GlowSuite kun je ondertussen gewoon gebruiken.",
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
  // The loaded view is bound to the exact auth user.id it was fetched for,
  // so a previous user's status or Viva link can never paint after a switch.
  const [loaded, setLoaded] = useState<{ userId: string | null; view: RegistrationView } | null>(null);

  useEffect(() => {
    // Reset on user switch / sign-out so a previous user's status or Viva
    // link is never shown while new data loads.
    setLoaded(null);
    if (authLoading) return;
    if (!user) { setLoaded({ userId: null, view: registrationView({ signedIn: false, hadError: false, row: null, trustedUrl: null }) }); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase as any)
        .from("glowpay_connected_merchants")
        .select("viva_account_id, viva_merchant_id, onboarding_status, kyc_status, online_payments_enabled, viva_source_code, onboarding_url, is_demo")
        .eq("user_id", user.id)
        .eq("is_demo", false)
        .maybeSingle();
      if (cancelled) return;
      setLoaded({
        userId: user.id,
        view: registrationView({
          signedIn: true,
          hadError: !!error,
          row: data ?? null,
          trustedUrl: trustedVivaUrl(data?.onboarding_url),
        }),
      });
    })();
    return () => { cancelled = true; };
  }, [user?.id, authLoading]);

  // Fail-closed during render itself: only show the view when it belongs to
  // the current auth user and auth has finished loading.
  const view = visibleView(loaded, user?.id ?? null, authLoading);
  const content = view?.kind === "status" ? STATUS_CONTENT[view.status] : null;
  const Icon = content?.icon;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center">
          <GlowSuiteLogo size="sm" withWordmark className="opacity-70" />
          <div className="mt-6 flex flex-col items-center space-y-3">
            <img
              src={glowpayLogo.url}
              alt="GlowPay"
              width={1470}
              height={335}
              className="h-auto w-40 max-w-full rounded-md object-contain"
            />
            <h1 className="text-2xl font-bold tracking-tight">Registratie bij Viva</h1>
            <p className="text-sm text-muted-foreground max-w-xs sm:max-w-sm">
              GlowPay is de betaaloplossing van GlowSuite. Viva verzorgt de registratie en controle van je betaalaccount.
              Terugkeren naar GlowSuite betekent niet automatisch dat de verificatie al is afgerond.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          {authLoading || view === null ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Status ophalen…
            </div>
          ) : view.kind === "signed_out" ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                Log in om de status van je GlowPay-registratie te bekijken.
              </p>
              <Button asChild variant="gradient" className="w-full">
                <Link to="/login"><LogIn className="w-4 h-4" /> Inloggen</Link>
              </Button>
            </div>
          ) : view.kind === "unavailable" ? (
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                <HelpCircle className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold">Status nog niet beschikbaar</p>
                <p className="text-sm text-muted-foreground mt-1">
                  We kunnen nu niet vaststellen of je registratie bij Viva is gestart of afgerond.
                  Controleer je status bij Viva of probeer het later opnieuw.
                </p>
              </div>
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
              {view.kind === "status" && view.continueUrl && view.status !== "active" && (
                <Button asChild variant="outline" className="w-full">
                  <a href={view.continueUrl} target="_blank" rel="noopener noreferrer">
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
