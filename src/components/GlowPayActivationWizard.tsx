import { useEffect, useMemo, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useSettings } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, ArrowRight, ArrowLeft, CreditCard, Smartphone,
  PlayCircle, Bot, CheckCircle2, Building2,
  Scissors, MessageCircle, Loader2, SkipForward, Upload,
  Gem, Stethoscope, Flower2, MoreHorizontal, Check,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props { open: boolean; onOpenChange: (o: boolean) => void; }

type Category = "kapper" | "barbershop" | "nagelsalon" | "beauty" | "kliniek" | "anders";

const CATEGORIES: { key: Category; label: string; icon: LucideIcon }[] = [
  { key: "kapper", label: "Kapper", icon: Scissors },
  { key: "barbershop", label: "Barbershop", icon: Scissors },
  { key: "nagelsalon", label: "Nagelstudio", icon: Sparkles },
  { key: "beauty", label: "Beauty salon", icon: Flower2 },
  { key: "kliniek", label: "Kliniek", icon: Stethoscope },
  { key: "anders", label: "Overig", icon: MoreHorizontal },
];

// Recommended defaults per category
const TEMPLATE_DEFAULTS: Record<Category, Record<string, any>> = {
  kapper:     { no_show_protection: "medium", reminders: true, deposits: false, memberships: false },
  barbershop: { no_show_protection: "low", reminders: true, deposits: false, memberships: false, fast_checkout: true, terminal_preferred: true },
  nagelsalon: { no_show_protection: "high", reminders: true, deposits: true, memberships: false },
  beauty:     { no_show_protection: "medium", reminders: true, deposits: true, memberships: true },
  kliniek:    { no_show_protection: "high", reminders: true, deposits: true, memberships: false, intake_reminders: true },
  anders:     { no_show_protection: "medium", reminders: true, deposits: false, memberships: false },
};

const DEFAULT_AUTOMATIONS = {
  appointment_reminders: true,
  no_show_prevention: true,
  payment_followup: true,
  membership_reminders: true,
};

export function GlowPayActivationWizard({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const { data: settings } = useSettings();
  const navigate = useNavigate();
  const settingsRow: any = settings?.[0];

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [salonName, setSalonName] = useState("");
  const [category, setCategory] = useState<Category>("kapper");
  const [logoUrl, setLogoUrl] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [merchantStatus, setMerchantStatus] = useState<string>("not_started");
  const [terminalCount, setTerminalCount] = useState(0);
  const [testPaying, setTestPaying] = useState(false);
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [automations, setAutomations] = useState(DEFAULT_AUTOMATIONS);
  const [whatsappConnected, setWhatsappConnected] = useState(false);

  const totalSteps = 7;
  const pct = ((step + 1) / totalSteps) * 100;

  // Initial load
  useEffect(() => {
    if (!open || !user) return;
    setSalonName(settingsRow?.salon_name || "");
    setContactEmail(user.email || "");
    setPhone(settingsRow?.salon_phone || "");
    const branding = (settingsRow?.whitelabel_branding && typeof settingsRow.whitelabel_branding === "object") ? settingsRow.whitelabel_branding : {};
    const saved = branding.glowpay_activation || {};
    if (saved.salon_category) setCategory(saved.salon_category);
    if (typeof saved.step === "number" && !saved.completed) setStep(Math.min(saved.step, totalSteps - 1));
    if (branding.payment_automations) setAutomations({ ...DEFAULT_AUTOMATIONS, ...branding.payment_automations });
    setLogoUrl(settingsRow?.salon_logo_url || "");

    (async () => {
      const [m, t, w] = await Promise.all([
        supabase.from("glowpay_connected_merchants" as any).select("onboarding_status").eq("user_id", user.id).eq("is_demo", demoMode).maybeSingle(),
        (supabase as any).from("viva_terminals").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "active"),
        (supabase as any).from("whatsapp_settings").select("status").eq("user_id", user.id).maybeSingle(),
      ]);
      setMerchantStatus(((m as any).data?.onboarding_status) || "not_started");
      setTerminalCount((t as any).count || 0);
      setWhatsappConnected(((w as any).data?.status || "") === "connected");
    })();
  }, [open, user?.id, demoMode, settingsRow?.id]);

  const persistActivation = useCallback(async (patch: Record<string, any>) => {
    if (!user || !settingsRow?.id) return;
    const branding = (settingsRow.whitelabel_branding && typeof settingsRow.whitelabel_branding === "object") ? settingsRow.whitelabel_branding : {};
    const current = branding.glowpay_activation || {};
    const next = { ...current, ...patch, updated_at: new Date().toISOString() };
    await supabase.from("settings").update({ whitelabel_branding: { ...branding, glowpay_activation: next } as any }).eq("id", settingsRow.id);
  }, [user?.id, settingsRow?.id, settingsRow?.whitelabel_branding]);

  // Realtime listener for first paid payment during the wizard
  useEffect(() => {
    if (!open || !user) return;
    const channel = supabase
      .channel(`glowpay-activation-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `user_id=eq.${user.id}` }, (payload: any) => {
        const row = payload.new || payload.record;
        if (row && row.status === "paid") {
          setPaymentReceived(true);
          persistActivation({ first_payment_completed: true, first_payment_at: new Date().toISOString() });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, user?.id, persistActivation]);

  const onLogoUpload = async (file: File) => {
    if (!user) return;
    const ext = file.name.split(".").pop() || "png";
    const path = `${user.id}/logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("salon-logos").upload(path, file, { upsert: true });
    if (error) { toast.error("Logo upload mislukt"); return; }
    const { data: pub } = supabase.storage.from("salon-logos").getPublicUrl(path);
    setLogoUrl(pub.publicUrl);
  };

  // ---- Step actions ----
  const saveBusiness = async () => {
    if (!user || !settingsRow?.id) return;
    await supabase.from("profiles").update({ salon_name: salonName.trim() || "Mijn Salon" }).eq("user_id", user.id);
    await (supabase.from("settings") as any).update({
      salon_name: salonName.trim() || "Mijn Salon",
      salon_phone: phone || null,
      salon_logo_url: logoUrl || null,
    }).eq("id", settingsRow.id);
    // Apply category template defaults (non-destructive — store under whitelabel_branding.glowpay_template)
    const branding = (settingsRow.whitelabel_branding && typeof settingsRow.whitelabel_branding === "object") ? settingsRow.whitelabel_branding : {};
    await supabase.from("settings").update({
      whitelabel_branding: {
        ...branding,
        glowpay_template: { category, ...TEMPLATE_DEFAULTS[category] },
      } as any,
    }).eq("id", settingsRow.id);
    await persistActivation({ salon_category: category, glowpay_connected: false });
  };

  const startMerchantOnboarding = async () => {
    if (demoMode) { toast.message("Demo modus", { description: "Activatie wordt gesimuleerd." }); return; }
    if (!salonName.trim() || !contactEmail.trim()) { toast.error("Bedrijfsnaam en e-mail vereist"); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-viva-connected-account", {
      body: { business_name: salonName.trim(), contact_email: contactEmail.trim(), phone: phone.trim() || null, country: "NL" },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.onboarding_url) {
      window.open((data as any).onboarding_url, "_blank", "noopener,noreferrer");
      toast.success("Activatie gestart in nieuw tabblad");
    }
    setMerchantStatus("pending");
    persistActivation({ glowpay_connected: true });
  };

  const startTestPayment = async () => {
    setTestPaying(true);
    if (demoMode) {
      setTimeout(() => { setPaymentReceived(true); setTestPaying(false); persistActivation({ first_payment_completed: true, first_payment_at: new Date().toISOString() }); }, 1400);
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("create-viva-payment", {
        body: {
          amount: 1.0,
          description: "GlowPay testbetaling",
          customer_email: contactEmail || user?.email,
          redirect_url: `${window.location.origin}/payment/success`,
        },
      });
      if (error) throw error;
      const url = (data as any)?.url || (data as any)?.checkout_url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else toast.message("Betaling aangemaakt", { description: "Wacht op bevestiging…" });
    } catch (e: any) {
      toast.error("Testbetaling mislukt: " + (e?.message || ""));
    } finally {
      setTestPaying(false);
    }
  };

  const saveAutomations = async () => {
    if (!settingsRow?.id) return;
    const branding = (settingsRow.whitelabel_branding && typeof settingsRow.whitelabel_branding === "object") ? settingsRow.whitelabel_branding : {};
    await supabase.from("settings").update({
      whitelabel_branding: { ...branding, payment_automations: automations } as any,
    }).eq("id", settingsRow.id);
  };

  const finish = async () => {
    await persistActivation({
      onboarding_completed: true,
      onboarding_step: totalSteps - 1,
      terminal_connected: terminalCount > 0,
      whatsapp_connected: whatsappConnected,
      completed_at: new Date().toISOString(),
      completed: true,
    });
    onOpenChange(false);
    toast.success("GlowSuite is volledig geconfigureerd");
  };

  const next = async () => {
    setBusy(true);
    try {
      if (step === 1) await saveBusiness();
      if (step === 5) await saveAutomations();
      const newStep = Math.min(step + 1, totalSteps - 1);
      setStep(newStep);
      await persistActivation({ onboarding_step: newStep });
      if (step === totalSteps - 1) await finish();
    } catch (e: any) {
      toast.error(e?.message || "Er ging iets mis");
    } finally {
      setBusy(false);
    }
  };
  const back = () => setStep(Math.max(0, step - 1));
  const skip = async () => {
    if (step === totalSteps - 1) { await finish(); return; }
    const newStep = Math.min(step + 1, totalSteps - 1);
    setStep(newStep);
    await persistActivation({ onboarding_step: newStep });
  };

  const STEP_LABELS = ["Welkom", "Bedrijf", "Activeer", "Pinapparaat", "Test", "Automations", "Klaar"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-full sm:max-w-xl h-[100dvh] sm:h-auto sm:max-h-[92vh] p-0 gap-0 overflow-hidden border-0 sm:border rounded-none sm:rounded-2xl flex flex-col">
        <div className="px-5 sm:px-7 pt-5 pb-3 border-b border-border/50 bg-gradient-to-br from-primary/[0.05] to-transparent">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="text-sm font-semibold">GlowPay activatie</span>
            </div>
            <button onClick={() => onOpenChange(false)} className="text-xs text-muted-foreground hover:text-foreground">Later afmaken</button>
          </div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground">Stap {step + 1} van {totalSteps} — {STEP_LABELS[step]}</p>
            <p className="text-xs font-semibold text-primary">{Math.round(pct)}%</p>
          </div>
          <Progress value={pct} className="h-1.5" />
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-6">
          {step === 0 && <WelcomeStep onStart={() => setStep(1)} />}
          {step === 1 && (
            <BusinessStep
              salonName={salonName} setSalonName={setSalonName}
              category={category} setCategory={setCategory}
              logoUrl={logoUrl} onLogo={onLogoUpload}
            />
          )}
          {step === 2 && (
            <ActivateStep
              demoMode={demoMode} salonName={salonName}
              email={contactEmail} setEmail={setContactEmail}
              phone={phone} setPhone={setPhone}
              status={merchantStatus} busy={busy}
              onStart={startMerchantOnboarding}
            />
          )}
          {step === 3 && (
            <TerminalStep terminalCount={terminalCount} onOpen={() => navigate("/instellingen?tab=betalingen")} />
          )}
          {step === 4 && (
            <TestPaymentStep demoMode={demoMode} testing={testPaying} paid={paymentReceived} onTest={startTestPayment} />
          )}
          {step === 5 && (
            <AutomationsStep automations={automations} setAutomations={setAutomations} whatsappConnected={whatsappConnected} onConnectWhatsapp={() => navigate("/whatsapp")} />
          )}
          {step === 6 && <DoneStep navigate={navigate} />}
        </div>

        <div className="px-5 sm:px-7 py-4 border-t border-border/50 bg-background flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={back} disabled={busy || step === 0}>
            <ArrowLeft className="w-4 h-4" /> Terug
          </Button>
          <div className="flex items-center gap-2">
            {step > 0 && step < totalSteps - 1 && (
              <Button variant="ghost" size="sm" onClick={skip} disabled={busy} className="text-muted-foreground">
                <SkipForward className="w-3.5 h-3.5" /> Overslaan
              </Button>
            )}
            <Button variant="gradient" size="sm" onClick={next} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : step === totalSteps - 1 ? "Afronden" : "Volgende"}
              {!busy && <ArrowRight className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- sub steps ---------------- */

function WelcomeStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-6 max-w-md mx-auto">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center mb-6 shadow-elegant">
        <Rocket className="w-10 h-10 text-primary-foreground" />
      </div>
      <h1 className="text-3xl font-bold tracking-tight mb-3">Welkom bij GlowPay</h1>
      <p className="text-base text-muted-foreground mb-8">Binnen enkele minuten kun je betalingen ontvangen — online én aan de balie.</p>
      <div className="grid grid-cols-2 gap-2 w-full mb-8 text-left">
        {[
          { i: CreditCard, t: "Online betalingen" },
          { i: Smartphone, t: "Pinapparaat" },
          { i: Bot, t: "Slimme automations" },
          { i: Sparkles, t: "Auto uitbetaling" },
        ].map(({ i: Icon, t }) => (
          <div key={t} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary/40 border border-border/50">
            <Icon className="w-4 h-4 text-primary" /><span className="text-sm font-medium">{t}</span>
          </div>
        ))}
      </div>
      <Button variant="gradient" size="lg" className="w-full" onClick={onStart}>Beginnen <ArrowRight className="w-4 h-4" /></Button>
    </div>
  );
}

function BusinessStep({ salonName, setSalonName, category, setCategory, logoUrl, onLogo }: any) {
  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Vertel over je salon</h2>
        <p className="text-sm text-muted-foreground mt-1">We stemmen GlowPay automatisch af op jouw type salon.</p>
      </div>
      <div>
        <Label>Salonnaam</Label>
        <Input value={salonName} onChange={(e) => setSalonName(e.target.value)} placeholder="Studio Nova" className="mt-1.5" />
      </div>
      <div>
        <Label>Type salon</Label>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-xl border p-3 text-sm transition",
                category === c.key ? "border-primary bg-primary/5 text-foreground" : "border-border bg-background hover:border-primary/40"
              )}
            >
              <span className="text-xl">{c.icon}</span>
              <span className="font-medium">{c.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label>Logo (optioneel)</Label>
        <label className="mt-1.5 flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="w-10 h-10 rounded-lg object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
              <Upload className="w-4 h-4 text-muted-foreground" />
            </div>
          )}
          <span className="text-sm text-muted-foreground flex-1">{logoUrl ? "Klik om te vervangen" : "Upload je logo"}</span>
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onLogo(e.target.files[0])} />
        </label>
      </div>
    </div>
  );
}

function ActivateStep({ demoMode, salonName, email, setEmail, phone, setPhone, status, busy, onStart }: any) {
  const connected = ["pending", "active", "completed"].includes(status);
  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Activeer GlowPay betalingen</h2>
        <p className="text-sm text-muted-foreground mt-1">We koppelen veilig je bedrijfsaccount voor uitbetalingen.</p>
      </div>
      {demoMode ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
          <p className="font-medium">Demo modus actief</p>
          <p className="text-muted-foreground text-[13px] mt-1">In demo werkt GlowPay als simulatie — er worden geen echte bedragen verwerkt.</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-3 text-sm">
            <Building2 className="w-4 h-4 text-primary" />
            <div className="flex-1"><p className="font-medium leading-tight">Bedrijfsaccount koppelen</p><p className="text-[12px] text-muted-foreground">Inclusief KYC en uitbetalingen</p></div>
            <span className={cn("text-[11px] px-2 py-0.5 rounded-full", connected ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground")}>
              {connected ? "Bezig/Actief" : "Niet gestart"}
            </span>
          </div>
          <div className="space-y-3">
            <div><Label>Contact e-mail</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" /></div>
            <div><Label>Telefoon</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+31 6 …" className="mt-1.5" /></div>
          </div>
          <Button variant="gradient" className="w-full" onClick={onStart} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "GlowPay betalingen activeren"}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">Je wordt veilig doorgeleid om je gegevens te verifiëren.</p>
        </>
      )}
    </div>
  );
}

function TerminalStep({ terminalCount, onOpen }: any) {
  return (
    <div className="space-y-5 max-w-lg mx-auto text-center">
      <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
        <Smartphone className="w-8 h-8 text-primary" />
      </div>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Koppel je pinapparaat</h2>
        <p className="text-sm text-muted-foreground mt-1">Optioneel — voor betalingen aan de balie.</p>
      </div>
      {terminalCount > 0 ? (
        <div className="rounded-xl border border-success/30 bg-success/5 p-4 inline-flex items-center gap-2 text-sm">
          <CheckCircle2 className="w-4 h-4 text-success" /> {terminalCount} pinapparaat{terminalCount === 1 ? "" : "ten"} gekoppeld
        </div>
      ) : (
        <Button variant="outline" onClick={onOpen} className="w-full">Pinapparaat koppelen in instellingen</Button>
      )}
      <p className="text-[12px] text-muted-foreground">Je kunt deze stap overslaan en later koppelen.</p>
    </div>
  );
}

function TestPaymentStep({ demoMode, testing, paid, onTest }: any) {
  if (paid) return <CelebrationScreen />;
  return (
    <div className="space-y-5 max-w-lg mx-auto text-center">
      <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
        <PlayCircle className="w-8 h-8 text-primary" />
      </div>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Doe een testbetaling</h2>
        <p className="text-sm text-muted-foreground mt-1">€1 — om te zien dat alles werkt. {demoMode ? "(gesimuleerd in demo)" : ""}</p>
      </div>
      <Button variant="gradient" size="lg" className="w-full" onClick={onTest} disabled={testing}>
        {testing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Bezig…</> : "Start testbetaling van €1"}
      </Button>
      <p className="text-[12px] text-muted-foreground">Zodra de betaling binnenkomt zie je hier een melding.</p>
    </div>
  );
}

function CelebrationScreen() {
  return (
    <div className="space-y-4 max-w-lg mx-auto text-center py-4 relative">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {Array.from({ length: 18 }).map((_, i) => (
          <span key={i}
            className="absolute text-2xl animate-fade-in"
            style={{
              left: `${(i * 53) % 100}%`,
              top: `${(i * 31) % 80}%`,
              animationDelay: `${(i % 6) * 0.08}s`,
              transform: `rotate(${(i * 23) % 360}deg)`,
            }}>
            {["🎉","✨","💜","💫","🌟"][i % 5]}
          </span>
        ))}
      </div>
      <div className="mx-auto w-20 h-20 rounded-3xl bg-gradient-to-br from-success to-primary flex items-center justify-center shadow-elegant animate-scale-in">
        <PartyPopper className="w-10 h-10 text-primary-foreground" />
      </div>
      <h2 className="text-2xl font-bold tracking-tight">Je eerste betaling is ontvangen 🎉</h2>
      <p className="text-sm text-muted-foreground">Uitbetalingen worden automatisch verwerkt — je hoeft niets te doen.</p>
    </div>
  );
}

function AutomationsStep({ automations, setAutomations, whatsappConnected, onConnectWhatsapp }: any) {
  const items: { key: keyof typeof DEFAULT_AUTOMATIONS; title: string; desc: string }[] = [
    { key: "appointment_reminders", title: "Afspraak herinneringen", desc: "Automatische WhatsApp 24u vooraf" },
    { key: "no_show_prevention", title: "No-show preventie", desc: "Bescherm je agenda automatisch" },
    { key: "payment_followup", title: "Betaling opvolging", desc: "Volg openstaande betalingen op" },
    { key: "membership_reminders", title: "Abonnement herinneringen", desc: "Hou klanten op de hoogte" },
  ];
  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Slimme automations</h2>
        <p className="text-sm text-muted-foreground mt-1">Aanbevolen voor jouw type salon — schakel in wat je wilt.</p>
      </div>
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.key} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-tight">{it.title}</p>
              <p className="text-[12px] text-muted-foreground mt-0.5">{it.desc}</p>
            </div>
            <Switch
              checked={Boolean(automations[it.key])}
              onCheckedChange={(v) => setAutomations({ ...automations, [it.key]: v })}
            />
          </div>
        ))}
      </div>
      {!whatsappConnected && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-primary" />
            <p className="text-sm font-semibold">Activeer WhatsApp herinneringen</p>
          </div>
          <p className="text-[12px] text-muted-foreground">Verstuur automatisch herinneringen — minder no-shows, meer omzet.</p>
          <Button variant="outline" size="sm" onClick={onConnectWhatsapp}>WhatsApp verbinden</Button>
        </div>
      )}
    </div>
  );
}

function DoneStep({ navigate }: any) {
  const links = [
    { t: "Agenda", to: "/agenda" },
    { t: "Kassa", to: "/kassa" },
    { t: "Klanten", to: "/klanten" },
    { t: "Dashboard", to: "/" },
  ];
  return (
    <div className="space-y-6 max-w-lg mx-auto text-center">
      <div className="mx-auto w-20 h-20 rounded-3xl bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center shadow-elegant">
        <PartyPopper className="w-10 h-10 text-primary-foreground" />
      </div>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Je bent klaar! 🎉</h2>
        <p className="text-sm text-muted-foreground mt-1">Je bent klaar om betalingen te ontvangen.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {links.map((l) => (
          <Button key={l.to} variant="outline" onClick={() => navigate(l.to)} className="h-auto py-4">{l.t}</Button>
        ))}
      </div>
    </div>
  );
}
