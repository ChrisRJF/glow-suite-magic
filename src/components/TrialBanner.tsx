import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sparkles, X, Loader2 } from "lucide-react";
import {
  useMySubscription,
  trialDaysLeft,
  startMollieCheckout,
} from "@/hooks/useSubscription";
import { toast } from "@/hooks/use-toast";

export function TrialBanner() {
  const { sub } = useMySubscription();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  const days = trialDaysLeft(sub);
  if (dismissed || days === null || !sub) return null;

  const expired = days <= 0;
  const urgent = days <= 3;

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
      className={`relative px-4 py-2.5 text-sm flex flex-wrap items-center justify-center gap-3 border-b ${
        expired
          ? "bg-destructive/10 border-destructive/30 text-destructive-foreground"
          : urgent
            ? "bg-warning/10 border-warning/30"
            : "bg-primary/5 border-primary/20"
      }`}
    >
      <Sparkles className="w-4 h-4 shrink-0" />
      <span className="font-medium">
        {expired
          ? "Je proefperiode is afgelopen — activeer nu om door te gaan."
          : `Nog ${days} ${days === 1 ? "dag" : "dagen"} gratis proefperiode.`}
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="gradient"
          onClick={upgrade}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            "Activeer abonnement"
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigate("/pricing")}
        >
          Plan bekijken
        </Button>
      </div>
      {!expired && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-foreground/5"
          aria-label="Sluiten"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
