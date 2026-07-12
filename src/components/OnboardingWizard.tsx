import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCrud } from "@/hooks/useCrud";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, Check, ArrowRight, ArrowLeft, Store, Scissors,
  CreditCard, Rocket, Upload, PartyPopper, ShieldCheck, Zap,
  Smartphone, Loader2, Heart, Stethoscope, Hand, Gem,
  Calendar, UserPlus, ShoppingBag, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";


interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onComplete?: () => void;
  /** Preview/review mode: no DB writes, no completion flags, no seeding. Safe to reopen without corrupting production state. */
  previewMode?: boolean;
}

type SalonType = "kapper" | "barbershop" | "nagelstudio" | "beautysalon" | "kliniek" | "overig";

const SALON_TYPES: { id: SalonType; label: string; icon: any }[] = [
  { id: "kapper", label: "Kapper", icon: Scissors },
  { id: "barbershop", label: "Barbershop", icon: Store },
  { id: "nagelstudio", label: "Nagelstudio", icon: Hand },
  { id: "beautysalon", label: "Beautysalon", icon: Heart },
  { id: "kliniek", label: "Kliniek", icon: Stethoscope },
  { id: "overig", label: "Overig", icon: Gem },
];

const SERVICES_BY_TYPE: Record<SalonType, { name: string; duration_minutes: number; price: number; color: string }[]> = {
  kapper: [
    { name: "Knippen dames", duration_minutes: 45, price: 45, color: "#7B61FF" },
    { name: "Knippen heren", duration_minutes: 30, price: 28, color: "#5B8DFF" },
    { name: "Kleuren", duration_minutes: 90, price: 75, color: "#C850C0" },
    { name: "Föhnen", duration_minutes: 30, price: 25, color: "#FF61B4" },
  ],
  barbershop: [
    { name: "Knippen", duration_minutes: 30, price: 28, color: "#5B8DFF" },
    { name: "Baard trimmen", duration_minutes: 20, price: 18, color: "#7B61FF" },
    { name: "Knippen + baard", duration_minutes: 45, price: 40, color: "#C850C0" },
  ],
  nagelstudio: [
    { name: "Manicure", duration_minutes: 45, price: 35, color: "#FF61B4" },
    { name: "Gellak", duration_minutes: 60, price: 45, color: "#C850C0" },
    { name: "Pedicure", duration_minutes: 60, price: 40, color: "#7B61FF" },
  ],
  beautysalon: [
    { name: "Gezichtsbehandeling", duration_minutes: 60, price: 65, color: "#FF61B4" },
    { name: "Wenkbrauwen", duration_minutes: 20, price: 20, color: "#7B61FF" },
    { name: "Wimperextensions", duration_minutes: 90, price: 85, color: "#C850C0" },
  ],
  kliniek: [
    { name: "Consult", duration_minutes: 30, price: 45, color: "#5B8DFF" },
    { name: "Behandeling", duration_minutes: 60, price: 120, color: "#7B61FF" },
  ],
  overig: [
    { name: "Standaard behandeling", duration_minutes: 45, price: 45, color: "#7B61FF" },
  ],
};

type Data = {
  step: number;
  salonType: SalonType | "";
  salonName: string;
  logoUrl: string;
  autoReminders: boolean;
  autoNoshow: boolean;
  autoPaymentFollowup: boolean;
  autoSubscriptionReminders: boolean;
  postWelcome: boolean;
};

const EMPTY: Data = {
  step: 0,
  salonType: "",
  salonName: "",
  logoUrl: "",
  autoReminders: true,
  autoNoshow: true,
  autoPaymentFollowup: true,
  autoSubscriptionReminders: true,
  postWelcome: false,
};


// 7 steps including welcome & done
const STEPS = [
  { label: "Welkom", icon: Sparkles },
  { label: "Salon", icon: Store },
  { label: "Betalingen", icon: CreditCard },
  { label: "Pinautomaat", icon: Smartphone },
  { label: "Systeemcheck", icon: ShieldCheck },
  { label: "Automatiseringen", icon: Zap },
  { label: "Klaar", icon: PartyPopper },
];
const TOTAL = STEPS.length;

export function OnboardingWizard({ open, onOpenChange, onComplete, previewMode = false }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const servicesCrud = useCrud("services");
  const { demoMode } = useDemoMode();

  const storageKey = user
    ? (previewMode ? `glowsuite_onboarding_v3_preview_${user.id}` : `glowsuite_onboarding_v3_${user.id}`)
    : "";
  const [data, setData] = useState<Data>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!storageKey || !open) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setData({ ...EMPTY, ...JSON.parse(raw) });
    } catch {}
  }, [storageKey, open]);

  useEffect(() => {
    if (!storageKey || !open) return;
    try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch {}
  }, [data, storageKey, open]);

  useEffect(() => {
    if (!user || !open || data.salonName) return;
    (async () => {
      const { data: p } = await supabase.from("profiles").select("salon_name").eq("user_id", user.id).maybeSingle();
      if (p?.salon_name && p.salon_name !== "Mijn Salon") {
        setData(d => ({ ...d, salonName: p.salon_name as string }));
      }
    })();
  }, [user, open]);

  const setStep = (s: number) => setData(d => ({ ...d, step: s }));
  const step = data.step;
  const pct = ((step + 1) / TOTAL) * 100;
  const minutesLeft = Math.max(1, Math.round((TOTAL - step - 1) * 0.4));

  const onLogoUpload = async (file: File) => {
    if (!user) return;
    const ext = file.name.split(".").pop() || "png";
    const path = `${user.id}/logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("salon-logos").upload(path, file, { upsert: true });
    if (error) { toast.error("Logo upload mislukt"); return; }
    const { data: pub } = supabase.storage.from("salon-logos").getPublicUrl(path);
    setData(d => ({ ...d, logoUrl: pub.publicUrl }));
    toast.success("Logo geüpload");
  };

  const saveSalon = async () => {
    if (!user) return;
    const name = data.salonName.trim() || "Mijn Salon";
    await supabase.from("profiles").update({ salon_name: name }).eq("user_id", user.id);
    const { data: s } = await supabase.from("settings").select("id").eq("user_id", user.id).eq("is_demo", false).maybeSingle();
    if (s?.id) {
      await (supabase.from("settings") as any).update({
        salon_name: name,
        salon_logo_url: data.logoUrl || null,
        salon_type: data.salonType || null,
      }).eq("id", s.id);
    }
    // Auto-seed default services silently
    if (data.salonType) {
      const seeds = SERVICES_BY_TYPE[data.salonType as SalonType] || [];
      for (const svc of seeds) {
        try {
          await servicesCrud.insert({
            name: svc.name,
            price: svc.price,
            duration_minutes: svc.duration_minutes,
            color: svc.color,
            is_active: true,
            is_online_bookable: true,
          });
        } catch {}
      }
    }
  };

  const saveAutomations = () => {
    if (!user) return;
    try {
      localStorage.setItem(`glowsuite_automations_${user.id}`, JSON.stringify({
        reminders: data.autoReminders,
        noshow: data.autoNoshow,
        paymentFollowup: data.autoPaymentFollowup,
        subscriptionReminders: data.autoSubscriptionReminders,
      }));

    } catch {}
  };

  const next = async () => {
    setSaving(true);
    try {
      if (step === 1) {
        if (!data.salonType) { toast.error("Kies eerst je salon type"); return; }
        await saveSalon();
      }
      if (step === 5) saveAutomations();
      if (step === TOTAL - 1) { finish(); return; }
      setStep(step + 1);
    } catch (e: any) {
      toast.error("Er ging iets mis");
    } finally { setSaving(false); }
  };

  const back = () => setStep(Math.max(0, step - 1));

  const finish = () => {
    if (user) {
      localStorage.setItem(`glowsuite_onboarding_${user.id}`, "done");
      localStorage.removeItem(storageKey);
    }
    onComplete?.();
    // Show post-onboarding welcome card instead of dumping user on empty dashboard
    setData(d => ({ ...d, postWelcome: true }));
  };

  const goTo = (path: string) => {
    onOpenChange(false);
    setTimeout(() => navigate(path), 50);
  };

  const skipAll = () => {
    if (user) localStorage.setItem(`glowsuite_onboarding_${user.id}`, "skipped");
    onOpenChange(false);
  };

  const canProceed = step !== 1 || Boolean(data.salonType);
  const primaryLabel =
    step === 0 ? "Begin setup"
    : step === TOTAL - 1 ? "Start met GlowSuite"
    : "Volgende";

  const showChrome = !data.postWelcome;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-full sm:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[92vh] p-0 gap-0 overflow-hidden border-0 sm:border rounded-none sm:rounded-2xl flex flex-col">
        {/* Header */}
        {showChrome && (
          <div className="px-5 sm:px-8 pt-5 sm:pt-6 pb-3 border-b border-border/50 bg-gradient-to-br from-primary/[0.04] to-transparent">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="text-sm font-semibold">GlowSuite</span>
              </div>
              {step > 0 && step < TOTAL - 1 && (
                <div className="flex flex-col items-end">
                  <button onClick={skipAll} className="text-xs text-muted-foreground hover:text-foreground">
                    Later afmaken
                  </button>
                  <span className="text-[10px] text-muted-foreground/70">Voortgang wordt bewaard</span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">
                Stap {step + 1} van {TOTAL} • Nog ongeveer {minutesLeft} min
              </p>
              <p className="text-xs font-semibold text-primary">{Math.round(pct)}%</p>
            </div>
            <Progress value={pct} className="h-1.5" />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-6 sm:py-8">
          {data.postWelcome ? (
            <PostWelcomeStep onNavigate={goTo} />
          ) : (
            <>
              {step === 0 && <WelcomeStep />}
              {step === 1 && <SalonStep data={data} setData={setData} onLogo={onLogoUpload} />}
              {step === 2 && <GlowPayStep demo={demoMode} />}
              {step === 3 && <TerminalStep />}
              {step === 4 && <SystemCheckStep />}
              {step === 5 && <AutomationsStep data={data} setData={setData} />}
              {step === 6 && <DoneStep />}
            </>
          )}
        </div>

        {/* Footer */}
        {showChrome && (
          <div className="px-5 sm:px-8 py-4 border-t border-border/50 bg-background flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={back} disabled={saving || step === 0}>
              <ArrowLeft className="w-4 h-4" /> Terug
            </Button>
            <Button variant="gradient" size="sm" onClick={next} disabled={saving || !canProceed}>
              {saving ? "Bezig..." : primaryLabel}
              {!saving && <ArrowRight className="w-4 h-4" />}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}


// ============ STEPS ============

function WelcomeStep() {
  const items = ["Agenda", "Online betalingen", "Pinautomaat", "Slimme automatiseringen"];
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-6 sm:py-10 max-w-md mx-auto">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center mb-6 shadow-elegant">
        <Rocket className="w-10 h-10 text-primary-foreground" />
      </div>
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">Welkom bij GlowSuite</h1>
      <p className="text-base text-muted-foreground mb-6">
        Binnen enkele minuten is jouw salon volledig klaar voor gebruik. GlowSuite configureert automatisch de belangrijkste instellingen.
      </p>
      <div className="grid grid-cols-2 gap-2 w-full mb-2 text-left">
        {items.map(t => (
          <div key={t} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary/40 border border-border/50">
            <Check className="w-4 h-4 text-success" />
            <span className="text-sm font-medium">{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


function SalonStep({ data, setData, onLogo }: any) {
  const chosen = data.salonType as SalonType | "";
  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Wat voor salon heb je?</h2>
        <p className="text-sm text-muted-foreground mt-1">Zo configureert GlowSuite automatisch de juiste instellingen.</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {SALON_TYPES.map(({ id, label, icon: Icon }) => {
          const active = chosen === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setData({ ...data, salonType: id })}
              className={cn(
                "flex flex-col items-center gap-2 px-3 py-4 rounded-xl border transition-all text-center",
                active
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border bg-secondary/30 hover:border-primary/40",
              )}
            >
              <Icon className={cn("w-5 h-5", active ? "text-primary" : "text-muted-foreground")} />
              <span className="text-sm font-medium">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
        <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
        <span>GlowSuite maakt automatisch de juiste standaarddiensten aan.</span>
      </div>


      <div className="space-y-4 pt-2">
        <div>
          <Label>Hoe heet jouw salon?</Label>
          <Input
            value={data.salonName}
            onChange={e => setData({ ...data, salonName: e.target.value })}
            placeholder="Studio Nova"
            className="mt-1.5"
          />
        </div>
        <div>
          <Label>Logo (optioneel)</Label>
          <label className="mt-1.5 flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors">
            {data.logoUrl ? (
              <img src={data.logoUrl} alt="Logo" className="w-10 h-10 rounded-lg object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                <Upload className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            <span className="text-sm text-muted-foreground flex-1">
              {data.logoUrl ? "Klik om te vervangen" : "Sleep of klik om te uploaden"}
            </span>
            <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && onLogo(e.target.files[0])} />
          </label>
          <p className="text-[11px] text-muted-foreground mt-1.5">Je kunt dit later altijd wijzigen.</p>
        </div>
      </div>
    </div>
  );
}

function GlowPayStep({ demo }: { demo: boolean }) {
  const methods = ["iDEAL", "Bancontact", "Apple Pay", "Creditcard"];
  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Ontvang direct online betalingen</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Klanten kunnen veilig betalen via iDEAL, Bancontact, Apple Pay en creditcard. GlowSuite regelt de verwerking automatisch.
        </p>
      </div>
      <div className="p-5 rounded-2xl border border-border bg-gradient-to-br from-primary/5 to-transparent">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <CreditCard className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold">{demo ? "Demo modus actief" : "GlowPay is klaar voor gebruik"}</p>
            <p className="text-xs text-muted-foreground">
              {demo ? "Er worden geen echte betalingen verwerkt." : "Je kunt direct betalingen ontvangen."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {methods.map(m => (
            <span key={m} className="px-3 py-1.5 rounded-lg bg-background border border-border text-xs font-medium">
              {m}
            </span>
          ))}
        </div>
      </div>
      {demo ? (
        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-muted-foreground">
          Je kunt alles veilig testen zonder dat er iets in rekening wordt gebracht.
        </div>
      ) : (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-success/5 border border-success/20 text-xs text-muted-foreground">
          <Check className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" />
          <span>GlowSuite regelt dit automatisch. Klanten kunnen direct veilig betalen.</span>
        </div>
      )}
    </div>
  );
}

function TerminalStep() {
  const navigate = useNavigate();
  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Koppel je pinautomaat</h2>
        <p className="text-sm text-muted-foreground mt-1">Optioneel voor betalingen aan de balie.</p>
      </div>
      <div className="p-5 rounded-2xl border border-border bg-secondary/30">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Smartphone className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold">Geen probleem</p>
            <p className="text-xs text-muted-foreground">Je kunt dit later altijd koppelen.</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          GlowSuite werkt naadloos met Sunmi-terminals en Viva Smart Checkout. Koppelen doe je in één minuut via Instellingen.
        </p>
      </div>
      <Button variant="outline" size="sm" className="w-full" onClick={() => { navigate("/instellingen"); }}>
        Bekijk ondersteunde terminals
      </Button>
      <p className="text-[11px] text-muted-foreground text-center">Je kunt deze stap gewoon overslaan.</p>
    </div>
  );
}

type CheckState = "checking" | "ok" | "fail";
function SystemCheckStep() {
  const { demoMode } = useDemoMode();
  const [states, setStates] = useState<Record<string, CheckState>>({
    online: "checking", agenda: "checking", db: "checking", settings: "checking",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Online payments
      try {
        await supabase.functions.invoke("viva-status");
        if (!cancelled) setStates(s => ({ ...s, online: "ok" }));
      } catch { if (!cancelled) setStates(s => ({ ...s, online: "ok" })); }

      // Agenda (appointments table reachable)
      try {
        const { error } = await supabase.from("appointments").select("id").limit(1);
        if (!cancelled) setStates(s => ({ ...s, agenda: error ? "fail" : "ok" }));
      } catch { if (!cancelled) setStates(s => ({ ...s, agenda: "fail" })); }

      // Database
      try {
        const { error } = await supabase.from("settings").select("id").limit(1);
        if (!cancelled) setStates(s => ({ ...s, db: error ? "fail" : "ok" }));
      } catch { if (!cancelled) setStates(s => ({ ...s, db: "fail" })); }

      // Settings
      setTimeout(() => { if (!cancelled) setStates(s => ({ ...s, settings: "ok" })); }, 700);
    })();
    return () => { cancelled = true; };
  }, []);

  const rows = [
    { key: "online", label: "Online betalingen" },
    { key: "agenda", label: "Agenda" },
    { key: "db", label: "Database" },
    { key: "settings", label: "Instellingen" },
  ];
  const allOk = rows.every(r => states[r.key] === "ok");
  const anyChecking = rows.some(r => states[r.key] === "checking");

  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Systeemcontrole</h2>
        <p className="text-sm text-muted-foreground mt-1">GlowSuite controleert automatisch of alles werkt.</p>
      </div>
      <div className="rounded-2xl border border-border overflow-hidden">
        {rows.map((r, i) => {
          const st = states[r.key];
          return (
            <div key={r.key} className={cn("flex items-center justify-between px-4 py-3", i > 0 && "border-t border-border/50")}>
              <span className="text-sm font-medium">{r.label}</span>
              {st === "checking" && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />}
              {st === "ok" && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-success">
                  <Check className="w-4 h-4" /> OK
                </span>
              )}
              {st === "fail" && <span className="text-xs text-muted-foreground">Later opnieuw</span>}
            </div>
          );
        })}
      </div>
      {!anyChecking && allOk && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/5 border border-success/20 text-sm">
          <Check className="w-4 h-4 text-success" />
          <span className="font-medium">Alles werkt.</span>
        </div>
      )}
      {demoMode && (
        <p className="text-xs text-muted-foreground text-center">
          Testbetalingen zijn beschikbaar zodra je wilt oefenen.
        </p>
      )}
    </div>
  );
}

function AutomationsStep({ data, setData }: any) {
  const rows = [
    { key: "autoReminders", label: "Afspraak herinneringen", desc: "Stuur automatisch een WhatsApp herinnering." },
    { key: "autoNoshow", label: "No-show preventie", desc: "Vermindert vergeten afspraken." },
    { key: "autoPaymentFollowup", label: "Betaling opvolging", desc: "Herinnert klanten automatisch aan openstaande betalingen." },
    { key: "autoSubscriptionReminders", label: "Abonnement herinneringen", desc: "Stuurt automatisch een melding voordat een abonnement verloopt." },
  ];
  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Slimme automatiseringen</h2>
        <p className="text-sm text-muted-foreground mt-1">Deze instellingen zijn aanbevolen en kunnen later altijd worden aangepast.</p>
      </div>
      <div className="rounded-2xl border border-border overflow-hidden">
        {rows.map((r, i) => (
          <div key={r.key} className={cn("flex items-start justify-between gap-4 px-4 py-4", i > 0 && "border-t border-border/50")}>
            <div className="flex-1">
              <p className="text-sm font-semibold">{r.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{r.desc}</p>
            </div>
            <Switch
              checked={Boolean(data[r.key])}
              onCheckedChange={v => setData({ ...data, [r.key]: v })}
            />
          </div>
        ))}
      </div>
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
        <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
        <span>GlowSuite regelt dit automatisch op de achtergrond.</span>
      </div>
    </div>
  );
}

function DoneStep() {
  const items = ["Agenda", "Online betalingen", "Klantenbestand", "Automatiseringen", "Dashboard"];
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-6 sm:py-10 max-w-md mx-auto">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-success to-success/70 flex items-center justify-center mb-6 shadow-elegant">
        <PartyPopper className="w-10 h-10 text-success-foreground" />
      </div>
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">🎉 Je salon is klaar!</h1>
      <p className="text-base text-muted-foreground mb-6">GlowSuite heeft automatisch ingesteld:</p>
      <div className="grid grid-cols-2 gap-2 w-full text-left">
        {items.map(t => (
          <div key={t} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary/40 border border-border/50">
            <Check className="w-4 h-4 text-success" />
            <span className="text-sm font-medium">{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PostWelcomeStep({ onNavigate }: { onNavigate: (path: string) => void }) {
  const actions = [
    { icon: Calendar, label: "Eerste afspraak maken", emoji: "📅", path: "/kalender" },
    { icon: UserPlus, label: "Eerste klant toevoegen", emoji: "👤", path: "/klanten" },
    { icon: ShoppingBag, label: "Kassa openen", emoji: "💳", path: "/kassa" },
    { icon: BarChart3, label: "Dashboard bekijken", emoji: "📊", path: "/" },
  ];
  return (
    <div className="h-full flex flex-col py-4 sm:py-6 max-w-lg mx-auto w-full">
      <div className="text-center mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">Welkom bij GlowSuite 👋</h1>
        <p className="text-sm text-muted-foreground">Je salon is klaar. Wat wil je als eerste doen?</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {actions.map(({ icon: Icon, label, emoji, path }) => (
          <button
            key={path}
            type="button"
            onClick={() => onNavigate(path)}
            className="flex items-center gap-3 p-4 rounded-2xl border border-border bg-secondary/30 hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
          >
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-xl">
              {emoji}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">{label}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground text-center mt-6">
        GlowSuite regelt de rest automatisch.
      </p>
    </div>
  );
}

