import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sparkles, Check, Loader2, ShieldCheck, Clock } from "lucide-react";
import { useSubscriptionState } from "@/contexts/SubscriptionStateContext";
import {
  useSubscriptionPlans,
  startMollieCheckout,
} from "@/hooks/useSubscription";
import { toast } from "@/hooks/use-toast";

/** Fullscreen blocking modal shown when trial has expired. */
export function TrialExpiredModal() {
  const { isReadOnly, sub } = useSubscriptionState();
  const { plans } = useSubscriptionPlans();
  const navigate = useNavigate();
  const [busySlug, setBusySlug] = useState<string | null>(null);

  if (!isReadOnly || !sub) return null;

  const handleUpgrade = async (slug: string, requiresDemo: boolean) => {
    if (requiresDemo) {
      navigate("/pricing");
      return;
    }
    try {
      setBusySlug(slug);
      const url = await startMollieCheckout(slug);
      window.location.href = url;
    } catch (e: any) {
      toast({
        title: "Kon checkout niet starten",
        description: e?.message || "Probeer het opnieuw.",
        variant: "destructive",
      });
      setBusySlug(null);
    }
  };

  return (
    <Dialog open modal>
      <DialogContent
        className="max-w-3xl p-0 overflow-hidden border-0 [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="relative bg-gradient-to-br from-background via-background to-primary/5 max-h-[90vh] overflow-y-auto">
          {/* Hero */}
          <div className="px-6 sm:px-10 pt-8 sm:pt-10 pb-6 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-warning/10 border border-warning/30 text-warning text-xs font-medium mb-4">
              <Clock className="w-3.5 h-3.5" />
              Proefperiode verlopen
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
              Activeer GlowSuite om door te gaan
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-md mx-auto">
              Je gegevens, klanten en agenda blijven bewaard. Kies een plan en ga
              direct verder.
            </p>
          </div>

          {/* Plans */}
          <div className="px-4 sm:px-10 pb-6 grid gap-4 sm:grid-cols-3">
            {plans.map((p) => {
              const highlighted = p.is_highlighted;
              return (
                <Card
                  key={p.slug}
                  className={`relative p-5 flex flex-col ${
                    highlighted
                      ? "border-primary/40 ring-2 ring-primary/20 bg-gradient-to-b from-primary/5 to-transparent"
                      : ""
                  }`}
                >
                  {highlighted && (
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold uppercase tracking-wide">
                      Meest gekozen
                    </div>
                  )}
                  <div className="flex items-baseline gap-1 mb-1">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="font-semibold">{p.name}</span>
                  </div>
                  <div className="mb-3">
                    {p.requires_demo ? (
                      <span className="text-xl font-bold">Op aanvraag</span>
                    ) : (
                      <>
                        <span className="text-3xl font-bold">€{Math.round(p.price_eur)}</span>
                        <span className="text-muted-foreground text-sm">/mnd</span>
                      </>
                    )}
                  </div>
                  <ul className="space-y-1.5 text-xs text-muted-foreground mb-4 flex-1">
                    {p.features.slice(0, 4).map((f, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <Check className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    variant={highlighted ? "gradient" : "default"}
                    disabled={busySlug === p.slug}
                    onClick={() => handleUpgrade(p.slug, p.requires_demo)}
                  >
                    {busySlug === p.slug ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : p.requires_demo ? (
                      "Demo aanvragen"
                    ) : (
                      "Betaal via Mollie"
                    )}
                  </Button>
                </Card>
              );
            })}
          </div>

          {/* Trust */}
          <div className="px-6 sm:px-10 pb-8 flex flex-wrap justify-center items-center gap-x-5 gap-y-2 text-xs text-muted-foreground border-t pt-4 mx-4 sm:mx-10">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-success" />
              Veilig betalen via Mollie
            </span>
            <span>Maandelijks opzegbaar</span>
            <span>Je data blijft bewaard</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
