import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Sparkles, ArrowLeft, Loader2 } from "lucide-react";
import logoFull from "@/assets/logo-full.png";
import { DemoRequestDialog } from "@/components/DemoRequestDialog";
import { DirectCheckoutDialog } from "@/components/DirectCheckoutDialog";
import { useSubscriptionPlans, startMollieCheckout } from "@/hooks/useSubscription";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

export default function PricingPage() {
  const { plans, loading } = useSubscriptionPlans();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoSource, setDemoSource] = useState("pricing-premium");
  const [busy, setBusy] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<{ slug: string; name: string; price: string } | null>(null);

  const onTrial = (slug: string, requiresDemo: boolean) => {
    if (requiresDemo) {
      setDemoSource(`pricing-${slug}-trial`);
      setDemoOpen(true);
      return;
    }
    navigate(`/login?mode=signup&plan=${slug}`);
  };

  const onPaid = async (slug: string, requiresDemo: boolean, name: string, priceEur: number) => {
    if (requiresDemo) {
      setDemoSource(`pricing-${slug}-paid`);
      setDemoOpen(true);
      return;
    }
    if (!user) {
      // Open public checkout dialog — no login required
      setCheckoutPlan({ slug, name, price: `€${Math.round(priceEur)}` });
      setCheckoutOpen(true);
      return;
    }
    try {
      setBusy(slug);
      const url = await startMollieCheckout(slug);
      window.location.href = url;
    } catch (e: any) {
      toast({
        title: "Kon niet doorgaan naar betaling",
        description: e?.message || "Probeer het later opnieuw.",
        variant: "destructive",
      });
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/60 bg-background/80 backdrop-blur-xl sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={logoFull} alt="GlowSuite" className="h-7" />
          </Link>
          <Link
            to="/"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            Terug
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="px-5 sm:px-8 pt-16 pb-10 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold tracking-wide uppercase mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            Prijzen
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Eenvoudige prijzen.<br className="hidden sm:block" /> Geen verrassingen.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            Start 14 dagen gratis. Geen creditcard nodig. Maandelijks opzegbaar.
          </p>
        </div>
      </section>

      {/* Plans */}
      <section className="px-5 sm:px-8 pb-24">
        <div className="max-w-6xl mx-auto">
          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-5 items-stretch">
              {plans.map((p) => (
                <Card
                  key={p.slug}
                  className={`p-6 sm:p-7 flex flex-col relative ${
                    p.is_highlighted
                      ? "border-primary/60 ring-2 ring-primary/30 md:scale-[1.03] z-10"
                      : ""
                  }`}
                  style={
                    p.is_highlighted
                      ? {
                          boxShadow:
                            "0 28px 70px -28px hsl(var(--primary) / 0.45)",
                        }
                      : undefined
                  }
                >
                  {p.is_highlighted && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))] text-white text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap shadow-lg">
                      Meest gekozen
                    </div>
                  )}

                  <div className="font-semibold text-lg">{p.name}</div>
                  {p.description && (
                    <div className="text-sm text-muted-foreground mt-1">
                      {p.description}
                    </div>
                  )}

                  <div className="mt-6 flex items-baseline gap-1">
                    <span className="text-5xl font-bold tracking-tight">
                      €{Math.round(Number(p.price_eur))}
                    </span>
                    <span className="text-muted-foreground">/maand</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    excl. btw • maandelijks opzegbaar
                  </div>

                  <ul className="mt-6 space-y-2.5 text-sm flex-1">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-7 flex flex-col gap-2">
                    <Button
                      type="button"
                      variant={p.is_highlighted ? "gradient" : "default"}
                      className="w-full"
                      onClick={() => onTrial(p.slug, p.requires_demo)}
                    >
                      {p.requires_demo
                        ? "Vraag demo aan"
                        : "Start 14 dagen gratis"}
                    </Button>
                    {!p.requires_demo && (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          disabled={busy === p.slug}
                          onClick={() => onPaid(p.slug, p.requires_demo, p.name, Number(p.price_eur))}
                        >
                          {busy === p.slug ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Bezig...
                            </>
                          ) : (
                            "Nu live starten"
                          )}
                        </Button>
                        <p className="text-[11px] text-muted-foreground text-center mt-1 leading-snug">
                          Veilig betalen via Mollie. Maandelijks opzegbaar.
                        </p>
                      </>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          <p className="mt-10 text-center text-sm text-muted-foreground">
            Veilige betalingen via Mollie • SEPA automatische incasso •
            Maandelijks opzegbaar
          </p>
        </div>
      </section>

      <DemoRequestDialog
        open={demoOpen}
        onOpenChange={setDemoOpen}
        source={demoSource}
      />
    </div>
  );
}
