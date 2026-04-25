import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sparkles, X, Loader2, AlertTriangle, Lock, CreditCard } from "lucide-react";
import { startMollieCheckout } from "@/hooks/useSubscription";
import { useSubscriptionState } from "@/contexts/SubscriptionStateContext";
import { toast } from "@/hooks/use-toast";

export function TrialBanner() {
  const { sub, daysLeft, isReadOnly } = useSubscriptionState();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!sub) return null;
  // expired handled by TrialExpiredModal — no banner needed
  if (isReadOnly) return null;
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
