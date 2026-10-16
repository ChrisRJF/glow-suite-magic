import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { usePlatformAccess } from "@/hooks/usePlatformAccess";
import { toast } from "sonner";
import { Building2, ExternalLink, RefreshCw, Loader2, ChevronDown } from "lucide-react";
import { registrationAction, kycLabel, onboardingLabel, MISSING_LINK_TEXT } from "@/lib/glowpayMerchantView";
import { glowpayPaymentStatus } from "@/lib/glowpayOnboardingStatus";

type Merchant = {
  id: string;
  viva_account_id: string | null;
  viva_merchant_id: string | null;
  business_name: string | null;
  contact_email: string | null;
  phone: string | null;
  country: string | null;
  onboarding_url: string | null;
  onboarding_status: string;
  kyc_status: string | null;
  payouts_enabled: boolean;
  terminals_enabled: boolean;
  online_payments_enabled: boolean;
  viva_source_code?: string | null;
  is_demo?: boolean | null;
  last_synced_at: string | null;
};

const yesNo = (v: boolean | undefined) => (v ? "Aan" : "Nog niet");

export function MerchantOnboardingCard() {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const platform = usePlatformAccess();
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("glowpay_connected_merchants")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_demo", demoMode)
      .maybeSingle();
    if (data) {
      setMerchant(data as any);
      setBusinessName((data as any).business_name || "");
      setEmail((data as any).contact_email || user.email || "");
      setPhone((data as any).phone || "");
    } else {
      setMerchant(null);
      setEmail(user.email || "");
    }
  };
  useEffect(() => { load(); }, [user?.id, demoMode]);

  const action = registrationAction(merchant);
  const payActive = glowpayPaymentStatus(merchant as any) === "active";

  const startOnboarding = async () => {
    // Nooit create bij bestaande merchant: alleen de "start"-actie mag hier komen.
    if (action.kind !== "start") return;
    if (!businessName.trim() || !email.trim()) { toast.error("Vul je bedrijfsnaam en e-mailadres in"); return; }
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("create-viva-connected-account", {
      body: { business_name: businessName.trim(), contact_email: email.trim(), phone: phone.trim() || null, country: "NL" },
    });
    setLoading(false);
    if (error) { toast.error("Registratie bij Viva is nu niet beschikbaar. Probeer het later opnieuw."); return; }
    if ((data as any)?.demo) {
      toast.message("Demo", { description: (data as any).message });
    } else if ((data as any)?.onboarding_url) {
      toast.success("Registratie gestart");
      window.open((data as any).onboarding_url, "_blank", "noopener,noreferrer");
    } else {
      toast.message("Je aanvraag is in behandeling. Klik niet opnieuw; neem contact op met GlowSuite als dit lang duurt.");
    }
    load();
  };

  const refresh = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("sync-viva-connected-account", { body: {} });
    setSyncing(false);
    if (error || (data as any)?.error) toast.error("Status vernieuwen lukt nu niet. Probeer het later opnieuw.");
    else toast.success("Status bijgewerkt");
    load();
  };

  return (
    <div className="rounded-xl border border-border bg-background/60 p-4 space-y-3 max-w-full overflow-hidden min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-semibold flex items-center gap-2"><Building2 className="w-4 h-4" /> Registratie bij Viva</p>
        {demoMode && <span className="text-xs text-muted-foreground">Demo</span>}
      </div>

      {demoMode && (
        <p className="text-xs text-muted-foreground rounded-md bg-muted/40 p-2 break-words">
          In de demo worden geen echte accounts aangemaakt en geen echte betalingen verwerkt.
        </p>
      )}

      {merchant?.viva_account_id ? (
        <div className="space-y-1 text-sm">
          <p className="font-medium">{payActive ? "GlowPay is actief" : kycLabel(merchant.kyc_status)}</p>
          <p className="text-xs text-muted-foreground">
            {payActive
              ? "Je kunt betalingen ontvangen via GlowPay."
              : "Je registratie bij Viva is gestart. Rond eventuele stappen af bij Viva. GlowSuite kun je ondertussen gewoon gebruiken."}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Maak je betaalaccount aan bij onze betaalpartner Viva. Viva controleert daarna je bedrijfsgegevens.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input aria-label="Bedrijfsnaam" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Bedrijfsnaam" className="text-sm h-10 rounded-md border border-border bg-background px-3 w-full min-w-0" />
            <input aria-label="E-mailadres" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mailadres" className="text-sm h-10 rounded-md border border-border bg-background px-3 w-full min-w-0" />
            <input aria-label="Telefoon" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefoon" className="text-sm h-10 rounded-md border border-border bg-background px-3 w-full min-w-0" />
          </div>
        </>
      )}

      {action.kind === "missing_link" && !payActive && (
        <p className="text-xs text-muted-foreground rounded-md bg-muted/40 p-2" role="status">{MISSING_LINK_TEXT}</p>
      )}

      <div className="flex flex-col sm:flex-row flex-wrap gap-2">
        {action.kind === "start" && (
          <Button size="sm" disabled={loading} onClick={startOnboarding} className="h-10 w-full sm:w-auto">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Start registratie bij Viva"}
          </Button>
        )}
        {action.kind === "continue" && !payActive && (
          <Button size="sm" asChild className="h-10 w-full sm:w-auto">
            <a href={action.url} target="_blank" rel="noopener noreferrer">
              Verder bij Viva <ExternalLink className="w-4 h-4 ml-1" />
            </a>
          </Button>
        )}
        {merchant?.viva_account_id && !demoMode && (
          <Button size="sm" variant="outline" disabled={syncing} onClick={refresh} className="h-10 w-full sm:w-auto">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <><RefreshCw className="w-4 h-4 mr-1" /> Status vernieuwen</>}
          </Button>
        )}
      </div>

      {platform.owner && merchant && (
        <details className="group text-xs rounded-md border border-border/60 p-2">
          <summary className="cursor-pointer list-none flex items-center justify-between text-muted-foreground">
            Technische details <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-2 min-w-0">
            <div className="break-words">Registratie: {onboardingLabel(merchant.onboarding_status)} <code className="break-all">({merchant.onboarding_status})</code></div>
            <div className="break-words">Verificatie: <code className="break-all">{merchant.kyc_status || "-"}</code></div>
            <div>Uitbetalingen: {yesNo(merchant.payouts_enabled)}</div>
            <div>Pinapparaten: {yesNo(merchant.terminals_enabled)}</div>
            <div>Online betalen: {yesNo(merchant.online_payments_enabled)}</div>
            <div className="break-words">Account-ID: <code className="break-all">{merchant.viva_account_id || "-"}</code></div>
            <div className="sm:col-span-2 break-words">Merchant-ID: <code className="break-all">{merchant.viva_merchant_id || "-"}</code></div>
            <div className="sm:col-span-2">Laatst bijgewerkt: {merchant.last_synced_at ? new Date(merchant.last_synced_at).toLocaleString("nl-NL") : "-"}</div>
          </div>
        </details>
      )}
    </div>
  );
}
