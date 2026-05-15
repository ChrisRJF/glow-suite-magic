import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { AlertCircle, CreditCard, Calendar, Receipt, RotateCcw, Heart, BellRing } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type AutomationKey =
  | "failed_payment_followup"
  | "membership_renewal_failed"
  | "refund_retention"
  | "noshow_prevention"
  | "unpaid_invoice"
  | "membership_renewal_reminder";

const DEFS: Array<{ key: AutomationKey; title: string; description: string; icon: any }> = [
  { key: "failed_payment_followup", title: "Betaling mislukt — vriendelijke opvolging", description: "Stuurt automatisch een nieuw betaallink-bericht via WhatsApp/e-mail wanneer een betaling niet doorging.", icon: AlertCircle },
  { key: "membership_renewal_failed", title: "Abonnement-incasso mislukt", description: "Lid krijgt direct een herstellink en wordt 24u later nogmaals geprobeerd.", icon: RotateCcw },
  { key: "refund_retention", title: "Refund retentiebericht", description: "Korte excuses + 10% korting voor de volgende afspraak nadat een terugbetaling is verstuurd.", icon: Heart },
  { key: "noshow_prevention", title: "No-show preventie", description: "Bevestigingsbericht 24u vooraf met heldere annuleringspolicy en \"ik kom\"-knop.", icon: Calendar },
  { key: "unpaid_invoice", title: "Open factuur reminder", description: "Vriendelijke herinnering 3 dagen na de afspraak als er nog niet is afgerekend.", icon: Receipt },
  { key: "membership_renewal_reminder", title: "Verlengingsherinnering abonnement", description: "Lid krijgt 5 dagen voor de volgende incasso een korte heads-up.", icon: BellRing },
];

const DEFAULTS: Record<AutomationKey, boolean> = {
  failed_payment_followup: true,
  membership_renewal_failed: true,
  refund_retention: false,
  noshow_prevention: true,
  unpaid_invoice: false,
  membership_renewal_reminder: true,
};

export function PaymentAutomationsCard() {
  const { user } = useAuth();
  const { hasAny } = useUserRole();
  const canManage = hasAny("eigenaar", "manager", "admin");
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [branding, setBranding] = useState<any>({});
  const [toggles, setToggles] = useState<Record<AutomationKey, boolean>>(DEFAULTS);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("settings").select("id, whitelabel_branding").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (data) {
        setSettingsId((data as any).id);
        const b = ((data as any).whitelabel_branding && typeof (data as any).whitelabel_branding === "object") ? (data as any).whitelabel_branding : {};
        setBranding(b);
        setToggles({ ...DEFAULTS, ...(b.payment_automations || {}) });
      }
    })();
  }, [user]);

  const save = async (key: AutomationKey, next: boolean) => {
    if (!settingsId || !canManage) return;
    setBusy(key);
    const updated = { ...toggles, [key]: next };
    setToggles(updated);
    const { error } = await supabase.from("settings").update({ whitelabel_branding: { ...branding, payment_automations: updated } }).eq("id", settingsId);
    setBusy(null);
    if (error) { toast.error("Kon niet opslaan"); return; }
    setBranding({ ...branding, payment_automations: updated });
    toast.success(next ? "Automatisering aangezet" : "Automatisering uitgezet");
  };

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-section-title">Betaal-slimmigheden</h2>
        <p className="text-meta mt-1">Voorkom gemiste omzet en houd klanten betrokken — automatisch.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {DEFS.map((d) => {
          const on = toggles[d.key];
          const Icon = d.icon;
          return (
            <Card key={d.key} className={cn(on && "ring-1 ring-primary/30")}>
              <CardContent className="p-4 flex items-start gap-3">
                <div className={cn("rounded-xl p-2.5 shrink-0", on ? "bg-gradient-to-br from-primary to-accent text-primary-foreground" : "bg-secondary text-muted-foreground")}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-sm">{d.title}</h3>
                    <Switch checked={on} disabled={!canManage || busy === d.key} onCheckedChange={(v) => save(d.key, v)} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{d.description}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
