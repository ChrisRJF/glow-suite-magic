import { useEffect, useState } from "react";
import { trialExtensionText } from "@/lib/trialExtension";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sparkles, X, Loader2, AlertTriangle, Lock, CreditCard } from "lucide-react";
import { startMollieCheckout } from "@/hooks/useSubscription";
import { useSubscriptionState } from "@/contexts/SubscriptionStateContext";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useSettings } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { glowpayPaymentStatus, type MerchantStatusRow } from "@/lib/glowpayOnboardingStatus";

/** Navigation only: never starts registration or refreshes provider status. */
function TrialGlowPayAction({ userId }: { userId: string }) {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRole();
  const { data: settings, loading: settingsLoading, error: settingsError } = useSettings();
  const navigate = useNavigate();
  const ownSettings = settings.find((row) => row.user_id === user?.id);
  const eligible = !authLoading && !rolesLoading && !settingsLoading && !settingsError &&
    user?.id === userId && ownSettings?.demo_mode === false &&
    roles.some((role) => role === "eigenaar" || role === "admin");
  const [loaded, setLoaded] = useState<{ userId: string; inactive: boolean } | null>(null);

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from("glowpay_connected_merchants")
          .select("viva_account_id,viva_merchant_id,onboarding_status,kyc_status,online_payments_enabled,viva_source_code,is_demo")
          .eq("user_id", userId)
          .eq("is_demo", false)
          .maybeSingle();
        if (!cancelled) setLoaded({ userId, inactive: !error && glowpayPaymentStatus(data as MerchantStatusRow) !== "active" });
      } catch {
        if (!cancelled) setLoaded({ userId, inactive: false });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [eligible, userId]);

  if (!eligible || loaded?.userId !== userId || !loaded.inactive) return null;
  return (
    <Button size="sm" variant="outline" className="w-full sm:w-auto shrink-0" onClick={() => navigate("/instellingen?tab=integraties")}>
      <CreditCard className="w-3.5 h-3.5 mr-1.5" />
      GlowPay activeren
    </Button>
  );
}

export function TrialBanner() {
  const { sub, daysLeft, isReadOnly } = useSubscriptionState();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!sub) return null;
  // expired handled by TrialExpiredModal — no banner needed
  if (isReadOnly) return null;

  // sub comes from useMySubscription(): filtered by .eq("user_id", auth.user.id) under RLS
  // "Users view own subscription", so sub.user_id is the signed-in user's own id.
  const extension = trialExtensionText(sub.user_id, sub);
  if (extension) {
    return (
      <div className="px-4 py-2.5 text-sm flex flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-2 sm:gap-3 border-b bg-primary/5 border-primary/20 text-center">
        <Sparkles className="w-4 h-4 shrink-0" />
        <span className="font-medium leading-tight">{extension}</span>
        <TrialGlowPayAction userId={sub.user_id} />
      </div>
    );
  }

  // Agreed free period (e.g. preparation + free month). Informational only:
  // no checkout button until a tested SaaS checkout exists.
  if (sub.free_period_starts_at && sub.status === "trialing") {
    const beforeStart = Date.now() < new Date(sub.free_period_starts_at).getTime();
    const fmt = (iso: string) =>
      new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });
    return (
      <div className="px-4 py-2.5 text-sm flex flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-2 sm:gap-3 border-b bg-primary/5 border-primary/20 text-center">
        <Sparkles className="w-4 h-4 shrink-0" />
        <span className="font-medium leading-tight">
          {beforeStart
            ? `Je account staat klaar voor ${fmt(sub.free_period_starts_at)}. Je gratis gebruiksmaand begint dan.`
            : `Je gebruikt GlowSuite gratis tot ${fmt(sub.trial_ends_at)}.`}
        </span>
        <TrialGlowPayAction userId={sub.user_id} />
      </div>
    );
  }

  if (daysLeft === null) return null;
  if (dismissed && daysLeft > 4) return null;

  const urgent = daysLeft <= 4;
  const critical = daysLeft <= 2;

  const upgrade = async () => {
    try {
      setBusy(true);
      const url = await startMollieCheckout(sub.plan_slug);
      window.location.href = url;
    } catch (e: any) {
      toast({
        title: "Kon checkout niet starten",
        description: e?.message || "Probeer het opnieuw.",
        variant: "destructive",
      });
      setBusy(false);
    }
  };

  return (
    <div
      className={`relative px-4 py-2.5 text-sm flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-center gap-2 sm:gap-3 border-b ${
        critical
          ? "bg-destructive/10 border-destructive/30"
          : urgent
            ? "bg-warning/10 border-warning/30"
            : "bg-primary/5 border-primary/20"
      }`}
    >
      <div className="flex items-center gap-2 justify-center text-center">
        {critical ? (
          <AlertTriangle className="w-4 h-4 shrink-0 text-destructive" />
        ) : (
          <Sparkles className="w-4 h-4 shrink-0" />
        )}
        <span className="font-medium leading-tight">
          {urgent
            ? `Nog ${daysLeft} ${daysLeft === 1 ? "dag" : "dagen"} gratis over — activeer je abonnement`
            : `Nog ${daysLeft} ${daysLeft === 1 ? "dag" : "dagen"} gratis proefperiode.`}
        </span>
      </div>
      <div className="flex items-center gap-2 sm:gap-2 w-full sm:w-auto justify-center">
        <Button size="sm" variant="gradient" className="flex-1 sm:flex-none" onClick={upgrade} disabled={busy}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Activeer abonnement"}
        </Button>
        <Button size="sm" variant="ghost" className="flex-1 sm:flex-none" onClick={() => navigate("/pricing")}>
          Plan bekijken
        </Button>
        <TrialGlowPayAction userId={sub.user_id} />
      </div>
      {!urgent && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="absolute right-2 top-2 sm:top-1/2 sm:-translate-y-1/2 p-2 rounded-md hover:bg-foreground/5"
          aria-label="Sluiten"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

/** Persistent strip shown when account is in read-only mode. */
export function ReadOnlyBanner() {
  const { isReadOnly } = useSubscriptionState();
  if (!isReadOnly) return null;
  return (
    <div className="bg-destructive/10 border-b border-destructive/30 text-destructive px-4 py-2 text-xs flex items-center justify-center gap-2 font-medium">
      <Lock className="w-3.5 h-3.5" />
      Alleen-lezen modus — activeer een abonnement om wijzigingen te maken.
    </div>
  );
}

/** Banner for past_due subscriptions (before grace period expires). */
export function PastDueBanner() {
  const { isPastDue, isReadOnly, pastDueDays } = useSubscriptionState();
  const navigate = useNavigate();
  if (!isPastDue || isReadOnly) return null;
  const daysLeftInGrace = Math.max(0, 7 - (pastDueDays ?? 0));
  return (
    <div className="bg-warning/10 border-b border-warning/30 px-4 py-2.5 text-sm flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-center gap-2 sm:gap-3">
      <div className="flex items-center gap-2 justify-center text-center">
        <AlertTriangle className="w-4 h-4 shrink-0 text-warning" />
        <span className="font-medium leading-tight">
          Betaling niet gelukt — los dit binnen {daysLeftInGrace}{" "}
          {daysLeftInGrace === 1 ? "dag" : "dagen"} op om alleen-lezen te voorkomen.
        </span>
      </div>
      <Button
        size="sm"
        variant="gradient"
        className="w-full sm:w-auto"
        onClick={() => navigate("/mijn-abonnement")}
      >
        <CreditCard className="w-3.5 h-3.5 mr-1.5" />
        Beheer abonnement
      </Button>
    </div>
  );
}
