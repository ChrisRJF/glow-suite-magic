import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { useCrud } from "@/hooks/useCrud";
import { User, Building, Bell, Save, CreditCard, Shield, RotateCcw, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function InstellingenPage() {
  const { user } = useAuth();
  const { data: settings, refetch } = useSettings();
  const { insert, update } = useCrud("settings");
  const [salonName, setSalonName] = useState("Mijn Salon");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notifications, setNotifications] = useState({ email: true, whatsapp: false, push: false });
  const [demoMode, setDemoMode] = useState(false);
  const [mollieMode, setMollieMode] = useState("test");
  const [depositNewClient, setDepositNewClient] = useState(true);
  const [depositPct, setDepositPct] = useState(50);
  const [fullPrepayThreshold, setFullPrepayThreshold] = useState(150);
  const [skipVip, setSkipVip] = useState(true);
  const [depositNoshow, setDepositNoshow] = useState(true);
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    if (settings.length > 0) {
      const s = settings[0] as any;
      setSalonName(s.salon_name || '');
      setNotifications({ email: s.email_enabled || false, whatsapp: s.whatsapp_enabled || false, push: false });
      setDemoMode(s.demo_mode || false);
      setMollieMode(s.mollie_mode || 'test');
      setDepositNewClient(s.deposit_new_client ?? true);
      setDepositPct(s.deposit_percentage ?? 50);
      setFullPrepayThreshold(Number(s.full_prepay_threshold) || 150);
      setSkipVip(s.skip_prepay_vip ?? true);
      setDepositNoshow(s.deposit_noshow_risk ?? true);
    }
    if (user) setEmail(user.email || '');
  }, [settings, user]);

  const handleSave = async () => {
    const data: Record<string, any> = {
      salon_name: salonName,
      email_enabled: notifications.email,
      whatsapp_enabled: notifications.whatsapp,
      demo_mode: demoMode,
      mollie_mode: mollieMode,
      deposit_new_client: depositNewClient,
      deposit_percentage: depositPct,
      full_prepay_threshold: fullPrepayThreshold,
      skip_prepay_vip: skipVip,
      deposit_noshow_risk: depositNoshow,
    };
    if (settings.length > 0) {
      await update(settings[0].id, data);
    } else {
      await insert(data);
    }
    toast.success("Instellingen opgeslagen!");
    refetch();
  };

  const handleDemoReset = async () => {
    setResetLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { error } = await supabase.functions.invoke("seed-demo-data", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (error) throw error;
        toast.success("Demo data opnieuw geladen!");
        refetch();
      }
    } catch (err: any) {
      toast.error(err.message || "Demo resetten mislukt");
    } finally {
      setResetLoading(false);
    }
  };

  const ToggleSwitch = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <button onClick={() => onChange(!value)}
      className={`w-10 h-6 rounded-full transition-colors ${value ? "bg-primary" : "bg-secondary"}`}>
      <div className={`w-4 h-4 rounded-full bg-white transition-transform ${value ? "translate-x-5" : "translate-x-1"}`} />
    </button>
  );

  return (
    <AppLayout title="Instellingen" subtitle="Account en saloninstellingen">
      <div className="grid gap-6 max-w-2xl">
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Building className="w-4 h-4 text-primary" /> Salon</h3>
          <div className="space-y-4">
            <div><label className="text-xs text-muted-foreground">Salonnaam</label><input value={salonName} onChange={(e) => setSalonName(e.target.value)} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
            <div><label className="text-xs text-muted-foreground">Telefoon</label><input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
          </div>
        </div>

        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><User className="w-4 h-4 text-primary" /> Account</h3>
          <div className="space-y-4">
            <div><label className="text-xs text-muted-foreground">E-mail</label><input value={email} disabled className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm opacity-60" /></div>
          </div>
        </div>

        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Bell className="w-4 h-4 text-primary" /> Notificaties</h3>
          <div className="space-y-3">
            {Object.entries(notifications).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between py-2">
                <span className="text-sm capitalize">{key === "whatsapp" ? "WhatsApp" : key === "email" ? "E-mail" : "Push"}</span>
                <ToggleSwitch value={val} onChange={(v) => setNotifications((p) => ({ ...p, [key]: v }))} />
              </div>
            ))}
          </div>
        </div>

        {/* Payment Settings */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" /> Betaalinstellingen</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm">Mollie modus</span>
                <p className="text-[11px] text-muted-foreground">Test of live betalingen</p>
              </div>
              <select value={mollieMode} onChange={(e) => setMollieMode(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm">
                <option value="test">Test</option>
                <option value="live">Live</option>
              </select>
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm">Aanbetaling nieuwe klant</span>
                <p className="text-[11px] text-muted-foreground">Vereis aanbetaling van nieuwe klanten</p>
              </div>
              <ToggleSwitch value={depositNewClient} onChange={setDepositNewClient} />
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm">Aanbetaling percentage</span>
                <p className="text-[11px] text-muted-foreground">Percentage van de totaalprijs</p>
              </div>
              <div className="flex items-center gap-1">
                <input type="number" min={10} max={100} value={depositPct} onChange={(e) => setDepositPct(Number(e.target.value))}
                  className="w-16 px-2 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm text-right" />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm">Volledige betaling vanaf</span>
                <p className="text-[11px] text-muted-foreground">Vereis volledige betaling boven dit bedrag</p>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">€</span>
                <input type="number" min={0} value={fullPrepayThreshold} onChange={(e) => setFullPrepayThreshold(Number(e.target.value))}
                  className="w-20 px-2 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm text-right" />
              </div>
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm">VIP overslaan</span>
                <p className="text-[11px] text-muted-foreground">VIP klanten betalen niet vooraf</p>
              </div>
              <ToggleSwitch value={skipVip} onChange={setSkipVip} />
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm">No-show risico aanbetaling</span>
                <p className="text-[11px] text-muted-foreground">Vereis aanbetaling bij no-show risico</p>
              </div>
              <ToggleSwitch value={depositNoshow} onChange={setDepositNoshow} />
            </div>
          </div>
        </div>

        {/* Demo Mode */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> Demo modus</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm">Demo modus actief</span>
                <p className="text-[11px] text-muted-foreground">Simuleer betalingen zonder echte transacties</p>
              </div>
              <ToggleSwitch value={demoMode} onChange={setDemoMode} />
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={handleDemoReset} disabled={resetLoading}>
              {resetLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
              {resetLoading ? "Laden..." : "Demo opnieuw laden"}
            </Button>
            <p className="text-[11px] text-muted-foreground/60 text-center">Herstelt alle demo data naar de originele staat</p>
          </div>
        </div>

        <Button onClick={handleSave} className="w-full" size="lg"><Save className="w-4 h-4 mr-2" /> Opslaan</Button>
      </div>
    </AppLayout>
  );
}
