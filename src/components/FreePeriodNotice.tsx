import { Card } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import type { UserSubscription } from "@/hooks/useSubscription";

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Amsterdam",
  });

/** Informational subscription view for accounts with an agreed free period. No checkout. */
export function FreePeriodNotice({ sub }: { sub: UserSubscription }) {
  return (
    <Card className="p-6 max-w-xl mx-auto space-y-3">
      <div className="flex items-center gap-2 text-primary">
        <Sparkles className="w-4 h-4" />
        <span className="text-sm font-medium">Gratis periode</span>
      </div>
      <h2 className="text-xl font-semibold">Je gebruikt GlowSuite gratis tot {fmt(sub.trial_ends_at)}</h2>
      <p className="text-sm text-muted-foreground">
        Je hoeft nu niets te doen. Je ontvangt op tijd bericht over het activeren van je abonnement.
      </p>
    </Card>
  );
}
