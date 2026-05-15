import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { toast } from "sonner";
import { Building2, ExternalLink, RefreshCw, Loader2 } from "lucide-react";

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
  last_synced_at: string | null;
};

export function MerchantOnboardingCard() {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
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

  const startOnboarding = async () => {
    if (!businessName.trim() || !email.trim()) { toast.error("Bedrijfsnaam en e-mail vereist"); return; }
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("create-viva-connected-account", {
      body: { business_name: businessName.trim(), contact_email: email.trim(), phone: phone.trim() || null, country: "NL" },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.demo) {
      toast.message("Demo modus", { description: (data as any).message });
    } else if ((data as any)?.onboarding_url) {
      toast.success("Onboarding gestart");
      window.open((data as any).onboarding_url, "_blank", "noopener,noreferrer");
    } else if ((data as any)?.error) {
      toast.error((data as any).error);
    }
    load();
  };

  const refresh = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("sync-viva-connected-account", { body: {} });
    setSyncing(false);
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.error) toast.error((data as any).error);
    else toast.success("Status bijgewerkt");
    load();
  };

  return (
    <div className="rounded-xl border border-border bg-background/60 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold flex items-center gap-2"><Building2 className="w-3.5 h-3.5" /> Merchant onboarding</p>
        <span className="text-[10px] text-muted-foreground">{demoMode ? "Demo" : "Live"}</span>
      </div>

      {demoMode && (
        <p className="text-[10px] text-muted-foreground rounded-md bg-muted/40 p-2">
          Demo modus gebruikt handmatige Viva credentials. Productie-onboarding gebruikt Viva connected accounts.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div><span className="text-muted-foreground">Status:</span> <code>{merchant?.onboarding_status || "not_started"}</code></div>
        <div><span className="text-muted-foreground">KYC:</span> <code>{merchant?.kyc_status || "—"}</code></div>
        <div><span className="text-muted-foreground">Payouts:</span> {merchant?.payouts_enabled ? "✓" : "—"}</div>
        <div><span className="text-muted-foreground">Terminals:</span> {merchant?.terminals_enabled ? "✓" : "—"}</div>
        <div><span className="text-muted-foreground">Online:</span> {merchant?.online_payments_enabled ? "✓" : "—"}</div>
        <div><span className="text-muted-foreground">Account:</span> <code className="break-all">{merchant?.viva_account_id || "—"}</code></div>
        <div className="col-span-2"><span className="text-muted-foreground">Merchant ID:</span> <code className="break-all">{merchant?.viva_merchant_id || "—"}</code></div>
        <div className="col-span-2"><span className="text-muted-foreground">Laatst gesynced:</span> {merchant?.last_synced_at ? new Date(merchant.last_synced_at).toLocaleString("nl-NL") : "—"}</div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Bedrijfsnaam" className="text-[11px] h-8 rounded-md border border-border bg-background px-2" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Contact e-mail" className="text-[11px] h-8 rounded-md border border-border bg-background px-2" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefoon" className="text-[11px] h-8 rounded-md border border-border bg-background px-2" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={loading} onClick={startOnboarding} className="h-8 text-[11px]">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Start Viva onboarding"}
        </Button>
        {merchant?.onboarding_url && (
          <Button size="sm" variant="outline" asChild className="h-8 text-[11px]">
            <a href={merchant.onboarding_url} target="_blank" rel="noopener noreferrer">
              Open onboarding link <ExternalLink className="w-3 h-3 ml-1" />
            </a>
          </Button>
        )}
        {merchant?.viva_account_id && !demoMode && (
          <Button size="sm" variant="outline" disabled={syncing} onClick={refresh} className="h-8 text-[11px]">
            {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <><RefreshCw className="w-3 h-3 mr-1" /> Refresh status</>}
          </Button>
        )}
      </div>
    </div>
  );
}
