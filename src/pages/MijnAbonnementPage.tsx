import { useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CreditCard,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RotateCcw,
  XCircle,
  ArrowUpRight,
} from "lucide-react";
import { useSubscriptionState } from "@/contexts/SubscriptionStateContext";
import {
  manageSubscription,
  startMollieCheckout,
  useSubscriptionPlans,
} from "@/hooks/useSubscription";
import { toast } from "@/hooks/use-toast";

const PLAN_LABEL: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  premium: "Premium",
};

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function StatusBadge({
  status,
  cancelScheduled,
}: {
  status: string;
  cancelScheduled: boolean;
}) {
  if (cancelScheduled) {
    return (
      <Badge className="bg-warning/15 text-warning hover:bg-warning/15">
        Loopt af eind periode
      </Badge>
    );
  }
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "Actief", cls: "bg-success/15 text-success hover:bg-success/15" },
    trialing: { label: "Proefperiode", cls: "bg-primary/15 text-primary hover:bg-primary/15" },
    past_due: { label: "Betaling open", cls: "bg-warning/15 text-warning hover:bg-warning/15" },
    pending: { label: "In behandeling", cls: "bg-muted text-muted-foreground" },
    expired: { label: "Verlopen", cls: "bg-destructive/15 text-destructive hover:bg-destructive/15" },
    canceled: { label: "Opgezegd", cls: "bg-destructive/15 text-destructive hover:bg-destructive/15" },
  };
  const m = map[status] ?? { label: status, cls: "bg-muted" };
  return <Badge className={m.cls}>{m.label}</Badge>;
}

export default function MijnAbonnementPage() {
  const { sub, loading, refresh, isPastDue, isCanceledScheduled, daysLeft } =
    useSubscriptionState();
  const { plans } = useSubscriptionPlans();
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const currentPlan = plans.find((p) => p.slug === sub?.plan_slug);

  const handleCheckout = async (planSlug: string) => {
    try {
      setBusy("checkout");
      const url = await startMollieCheckout(planSlug);
      window.location.href = url;
    } catch (e: any) {
      toast({
        title: "Kon checkout niet starten",
        description: e?.message || "Probeer het opnieuw.",
        variant: "destructive",
      });
      setBusy(null);
    }
  };

  const handleCancel = async () => {
    try {
      setBusy("cancel");
      await manageSubscription("cancel");
      await refresh();
      toast({
        title: "Abonnement opgezegd",
        description: `Je houdt toegang tot ${formatDate(sub?.current_period_end)}.`,
      });
      setCancelOpen(false);
    } catch (e: any) {
      toast({
        title: "Opzeggen mislukt",
        description: e?.message || "Probeer het opnieuw.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleReactivate = async () => {
    try {
      setBusy("reactivate");
      await manageSubscription("reactivate");
      await refresh();
      toast({
        title: "Welkom terug",
        description: "Je abonnement loopt gewoon door.",
      });
    } catch (e: any) {
      toast({
        title: "Reactivering mislukt",
        description: e?.message || "Probeer het opnieuw.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleChangePlan = async (planSlug: string) => {
    try {
      setBusy("change");
      await manageSubscription("change_plan", planSlug);
      await refresh();
      toast({
        title: "Plan gewijzigd",
        description: `Je bent nu op het ${PLAN_LABEL[planSlug]} plan.`,
      });
    } catch (e: any) {
      toast({
        title: "Wijzigen mislukt",
        description: e?.message || "Probeer het opnieuw.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <AppLayout title="Mijn abonnement">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Mijn abonnement"
      subtitle="Beheer je GlowSuite abonnement, betaalstatus en plan."
    >
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Past due alert */}
        {isPastDue && (
          <Card className="p-4 sm:p-5 border-warning/40 bg-warning/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">
                  Je laatste betaling is niet gelukt
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  We proberen het binnen 3 dagen automatisch nog één keer. Je
                  kunt nu zelf een nieuwe poging starten of je betaalmethode
                  bijwerken.
                </p>
                <Button
                  size="sm"
                  variant="gradient"
                  className="mt-3 w-full sm:w-auto"
                  onClick={() => sub && handleCheckout(sub.plan_slug)}
                  disabled={!!busy}
                >
                  {busy === "checkout" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Nu betalen"
                  )}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Cancel scheduled */}
        {isCanceledScheduled && (
          <Card className="p-4 sm:p-5 border-warning/40 bg-warning/5">
            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">
                  Opgezegd — toegang tot {formatDate(sub?.current_period_end)}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Je abonnement wordt niet verlengd. Daarna gaat je account in
                  alleen-lezen modus. Je kunt dit nog terugdraaien.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full sm:w-auto"
                  onClick={handleReactivate}
                  disabled={!!busy}
                >
                  {busy === "reactivate" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Toch doorgaan
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Plan card */}
        <Card className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-bold">
                  {currentPlan?.name || PLAN_LABEL[sub?.plan_slug ?? ""] || "—"}
                </h2>
                {sub && (
                  <StatusBadge
                    status={sub.status}
                    cancelScheduled={isCanceledScheduled}
                  />
                )}
              </div>
              {currentPlan && (
                <p className="text-2xl font-bold text-foreground">
                  €{Number(currentPlan.price_eur).toFixed(0)}
                  <span className="text-sm text-muted-foreground font-normal">
                    {" "}/ maand
                  </span>
                </p>
              )}
            </div>
            <CreditCard className="w-8 h-8 text-muted-foreground/40" />
          </div>

          <div className="mt-6 grid sm:grid-cols-2 gap-4 text-sm">
            {sub?.status === "trialing" && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  Proefperiode tot
                </p>
                <p className="font-medium mt-0.5">
                  {formatDate(sub.trial_ends_at)}
                  {daysLeft !== null && (
                    <span className="text-muted-foreground font-normal">
                      {" "}({daysLeft} {daysLeft === 1 ? "dag" : "dagen"})
                    </span>
                  )}
                </p>
              </div>
            )}
            {sub?.current_period_start && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  Huidige periode
                </p>
                <p className="font-medium mt-0.5">
                  {formatDate(sub.current_period_start)}
                </p>
              </div>
            )}
            {sub?.current_period_end && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  {isCanceledScheduled
                    ? "Loopt af op"
                    : sub.status === "active"
                      ? "Volgende incasso"
                      : "Periode eindigt"}
                </p>
                <p className="font-medium mt-0.5">
                  {formatDate(sub.current_period_end)}
                </p>
              </div>
            )}
            {sub?.mollie_customer_id && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  Betaalmethode
                </p>
                <p className="font-medium mt-0.5 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-success" />
                  Automatische incasso actief
                </p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          {sub?.status === "trialing" && (
            <div className="mt-6 pt-5 border-t flex flex-wrap gap-2">
              <Button
                variant="gradient"
                onClick={() => sub && handleCheckout(sub.plan_slug)}
                disabled={!!busy}
              >
                {busy === "checkout" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Activeer abonnement nu"
                )}
              </Button>
              <Button asChild variant="ghost">
                <Link to="/pricing">Bekijk alle plannen</Link>
              </Button>
            </div>
          )}

          {sub?.status === "active" && !isCanceledScheduled && (
            <div className="mt-6 pt-5 border-t flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => setCancelOpen(true)}
                disabled={!!busy}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Abonnement opzeggen
              </Button>
            </div>
          )}

          {(sub?.status === "expired" || sub?.status === "canceled") && (
            <div className="mt-6 pt-5 border-t">
              <Button
                variant="gradient"
                onClick={() => sub && handleCheckout(sub.plan_slug)}
                disabled={!!busy}
              >
                {busy === "checkout" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Heractiveer abonnement"
                )}
              </Button>
            </div>
          )}
        </Card>

        {/* Plan switcher (only when active and not scheduled to cancel) */}
        {sub?.status === "active" && !isCanceledScheduled && plans.length > 0 && (
          <Card className="p-5 sm:p-6">
            <h3 className="font-semibold text-foreground mb-1">Wissel van plan</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Wijziging gaat per direct in. Je betaalmethode blijft hetzelfde.
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              {plans.map((plan) => {
                const isCurrent = plan.slug === sub.plan_slug;
                return (
                  <div
                    key={plan.slug}
                    className={`p-4 rounded-xl border ${
                      isCurrent
                        ? "border-primary/40 bg-primary/5"
                        : "border-border"
                    }`}
                  >
                    <p className="font-semibold">{plan.name}</p>
                    <p className="text-lg font-bold mt-1">
                      €{Number(plan.price_eur).toFixed(0)}
                      <span className="text-xs text-muted-foreground font-normal">
                        {" "}/mnd
                      </span>
                    </p>
                    {isCurrent ? (
                      <Badge variant="secondary" className="mt-3 w-full justify-center">
                        Huidig plan
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 w-full"
                        onClick={() => handleChangePlan(plan.slug)}
                        disabled={!!busy}
                      >
                        {busy === "change" ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            Wissel
                            <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abonnement opzeggen?</AlertDialogTitle>
            <AlertDialogDescription>
              Je behoudt volledige toegang tot{" "}
              <strong>{formatDate(sub?.current_period_end)}</strong>. Daarna
              gaat je account in alleen-lezen modus. Je kunt dit later nog
              terugdraaien.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "cancel"}>
              Toch niet
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleCancel();
              }}
              disabled={busy === "cancel"}
            >
              {busy === "cancel" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Ja, zeg op"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
