import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircle2, Circle, CreditCard, Smartphone, PlayCircle, Sparkles } from "lucide-react";

type Props = {
  vivaConfigured: boolean;
  vivaActivation: string;
  paymentProvider: string;
  demoMode: boolean;
};

type Step = {
  key: string;
  title: string;
  description: string;
  done: boolean;
  icon: React.ComponentType<{ className?: string }>;
};

export function GlowPaySetupCard({ vivaConfigured, vivaActivation, paymentProvider, demoMode }: Props) {
  const { user } = useAuth();
  const [terminalCount, setTerminalCount] = useState(0);
  const [hasPaidPayment, setHasPaidPayment] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const [tRes, pRes] = await Promise.all([
        (supabase as any)
          .from("viva_terminals")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "active"),
        (supabase as any)
          .from("payments")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "paid")
          .ilike("provider", "%viva%"),
      ]);
      if (!active) return;
      setTerminalCount(tRes?.count || 0);
      setHasPaidPayment((pRes?.count || 0) > 0);
    })();
    return () => { active = false; };
  }, [user]);

  const paymentsActive = paymentProvider === "viva" && vivaConfigured && vivaActivation === "active";
  const accountConnected = vivaConfigured || vivaActivation === "active";

  const steps: Step[] = [
    {
      key: "activate",
      title: "Activeer betalingen",
      description: accountConnected ? "Bedrijfsaccount gekoppeld" : "Vraag activatie aan via Viva",
      done: accountConnected,
      icon: CreditCard,
    },
    {
      key: "terminal",
      title: "Koppel pinapparaat",
      description: terminalCount > 0 ? "Pinapparaat gekoppeld" : "Voeg een pinapparaat toe (optioneel)",
      done: terminalCount > 0,
      icon: Smartphone,
    },
    {
      key: "test",
      title: "Doe testbetaling",
      description: hasPaidPayment ? "Laatste testbetaling gelukt" : "Maak een proefbetaling",
      done: hasPaidPayment,
      icon: PlayCircle,
    },
    {
      key: "ready",
      title: "Klaar om betalingen te ontvangen",
      description: paymentsActive && hasPaidPayment ? "Betalingen actief · Uitbetalingen via Viva" : "Voltooi de stappen hierboven",
      done: paymentsActive && hasPaidPayment,
      icon: Sparkles,
    },
  ];

  const completed = steps.filter((s) => s.done).length;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">GlowPay setup</p>
          <p className="text-[12px] text-muted-foreground">In 4 stappen klaar voor betalingen</p>
        </div>
        <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-secondary text-secondary-foreground whitespace-nowrap">
          {completed}/{steps.length} klaar
        </span>
      </div>

      {demoMode && (
        <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 text-[12px] text-foreground">
          Demo modus: betalingen worden gesimuleerd of getest. Live activatie gebeurt via Viva.
        </div>
      )}

      <div className="space-y-2">
        {steps.map((step, idx) => {
          const Icon = step.icon;
          return (
            <div
              key={step.key}
              className={`flex items-center gap-3 rounded-xl border p-3 transition ${
                step.done ? "border-success/30 bg-success/5" : "border-border bg-background"
              }`}
            >
              <div className={`flex-shrink-0 h-9 w-9 rounded-full flex items-center justify-center ${step.done ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"}`}>
                {step.done ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium leading-tight">
                  <span className="text-muted-foreground mr-1">{idx + 1}.</span>
                  {step.title}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{step.description}</p>
              </div>
              {step.done ? (
                <span className="text-[10px] font-medium text-success">Klaar</span>
              ) : (
                <Circle className="w-4 h-4 text-muted-foreground/40" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
