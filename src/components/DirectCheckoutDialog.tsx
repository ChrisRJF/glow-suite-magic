import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, Lock, CreditCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface DirectCheckoutDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  planSlug: string | null;
  planName?: string;
  planPrice?: string;
}

export function DirectCheckoutDialog({
  open,
  onOpenChange,
  planSlug,
  planName,
  planPrice,
}: DirectCheckoutDialogProps) {
  const [email, setEmail] = useState("");
  const [salonName, setSalonName] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planSlug || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "saas-checkout-public",
        {
          body: {
            plan_slug: planSlug,
            email: email.trim(),
            salon_name: salonName.trim(),
            full_name: fullName.trim(),
          },
        },
      );
      if (error) throw error;
      if (!data?.checkout_url) throw new Error("Geen checkout-url ontvangen");
      window.location.href = data.checkout_url as string;
    } catch (err: any) {
      toast({
        title: "Kon checkout niet starten",
        description: err?.message || "Probeer het opnieuw.",
        variant: "destructive",
      });
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Direct activeren{planName ? ` — ${planName}` : ""}
          </DialogTitle>
          <DialogDescription>
            {planPrice
              ? `${planPrice} per maand. Maandelijks opzegbaar.`
              : "Maandelijks opzegbaar."}{" "}
            Je gaat direct door naar de beveiligde Mollie betaalpagina.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3 pt-2">
          <div>
            <label className="text-xs text-muted-foreground">Salonnaam</label>
            <input
              type="text"
              required
              value={salonName}
              onChange={(e) => setSalonName(e.target.value)}
              className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Bijv. Studio Nova"
              autoComplete="organization"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Jouw naam</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Voor- en achternaam"
              autoComplete="name"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">E-mailadres</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="jouw@email.nl"
              autoComplete="email"
            />
          </div>

          <Button
            type="submit"
            variant="gradient"
            className="w-full h-11 text-base font-semibold mt-2"
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Doorsturen naar betaling...
              </>
            ) : (
              <>Doorgaan naar Mollie</>
            )}
          </Button>

          <ul className="grid grid-cols-1 gap-1.5 pt-1">
            <li className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
              Veilig betalen via Mollie
            </li>
            <li className="flex items-center gap-2 text-xs text-muted-foreground">
              <CreditCard className="w-3.5 h-3.5 text-primary shrink-0" />
              SEPA, iDEAL, Bancontact, creditcard
            </li>
            <li className="flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="w-3.5 h-3.5 text-primary shrink-0" />
              Maandelijks opzegbaar — direct actief, geen trial
            </li>
          </ul>
        </form>
      </DialogContent>
    </Dialog>
  );
}
