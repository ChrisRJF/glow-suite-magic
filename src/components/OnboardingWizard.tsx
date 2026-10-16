import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCrud } from "@/hooks/useCrud";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { OnboardingSaveError, describeOnboardingSaveError } from "@/lib/onboardingSaveError";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, Check, ArrowRight, ArrowLeft, Store, Scissors,
  CreditCard, Rocket, Upload, PartyPopper, ShieldCheck, Zap, LockKeyhole,
  Smartphone, Loader2, Heart, Stethoscope, Hand, Gem,
  Calendar, UserPlus, ShoppingBag, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { glowpayPaymentStatus, bookingStatus, type PayStatus, type BookingStatus } from "@/lib/glowpayOnboardingStatus";
import glowsuiteLogo from "@/assets/glowsuite-logo.png";
import glowpayLogo from "@/assets/glowpay/glowpay-logo.png.asset.json";
import { missingSeedServices } from "@/lib/onboardingServiceSeed";
import { buildSettingsPayload } from "@/lib/onboardingSalonProfile";
import { inviteActionFromResponse, inviteActionFromError, INVITE_UNAVAILABLE } from "@/lib/vivaInviteAction";


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
  const busyRef = useRef(false);
  const [loadedKey, setLoadedKey] = useState("");

  useEffect(() => {
    if (!storageKey || !open) return;
    try {
      const raw = localStorage.getItem(storageKey);
      setData(raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY);
    } catch { setData(EMPTY); }
    setLoadedKey(storageKey);
  }, [storageKey, open]);

  useEffect(() => {
    if (!storageKey || !open || loadedKey !== storageKey || data.postWelcome) return;
    try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch {}
  }, [data, storageKey, open, loadedKey]);

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
    if (previewMode) {
      setData(d => ({ ...d, logoUrl: URL.createObjectURL(file) }));
      return;
    }
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
    if (!user) throw new Error("Niet ingelogd");
    // Preview mode: never touch DB, never seed services, never overwrite settings/logo/salon-type.
    if (previewMode) return;
    const name = data.salonName.trim() || "Mijn Salon";
    const { error: profileError } = await supabase.from("profiles").update({ salon_name: name }).eq("user_id", user.id);
    if (profileError) throw new OnboardingSaveError("profile", profileError);
    // Deliberately maybeSingle: if several non-demo settings rows exist we stop (PGRST116)
    // instead of silently picking an arbitrary one.
    const { data: s, error: settingsError } = await supabase.from("settings").select("id").eq("user_id", user.id).eq("is_demo", false).maybeSingle();
    if (settingsError) throw new OnboardingSaveError("settings_lookup", settingsError);
    // Gate-controlled: until the proposed settings migration is applied only salon_name is sent.
    const built = buildSettingsPayload({
      name, salonType: data.salonType, logoUrl: data.logoUrl, userId: user.id,
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
    });
    let persistedExtras = false;
    if (s?.id) {
      const { error } = await (supabase.from("settings") as any).update(built.payload).eq("id", s.id);
      if (error) throw new OnboardingSaveError("settings_update", error);
      persistedExtras = built.persistedExtras;
    }
    if ((data.logoUrl || data.salonType) && !persistedExtras) {
      toast.info("Salonnaam opgeslagen. Logo en salontype worden nog niet definitief bewaard en blijven in deze wizard staan.");
    }
    // Recoverable, idempotent seeding scoped to this salon: fills only missing default services
    // after a partial failure, never duplicates and skips salons that have their own services.
    if (data.salonType) {
      const { data: rows, error } = await supabase
        .from("services")
        .select("name")
        .eq("user_id", user.id);
      if (error || !Array.isArray(rows)) throw new OnboardingSaveError("services_check", error);
      const seeds = SERVICES_BY_TYPE[data.salonType as SalonType] || [];
      const missing = missingSeedServices(seeds, rows.map((r: any) => String(r?.name ?? "")));
      for (const svc of missing) {
        const inserted = await servicesCrud.insert({
            name: svc.name,
            price: svc.price,
            duration_minutes: svc.duration_minutes,
            color: svc.color,
            is_active: true,
            is_online_bookable: true,
          });
        if (!inserted) throw new OnboardingSaveError("services_seed", null);
      }
    }
  };

  const saveAutomations = () => {
    if (!user || previewMode) return;
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
    if (busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    try {
      if (step === 1) {
        if (!data.salonType || !data.salonName.trim()) { toast.error("Vul je salonnaam in en kies je salontype"); return; }
        await saveSalon();
      }
      if (step === 5) saveAutomations();
      if (step === TOTAL - 1) { finish(); return; }
      setStep(step + 1);
    } catch (e: unknown) {
      toast.error(describeOnboardingSaveError(e));
    } finally { busyRef.current = false; setSaving(false); }
  };

  const back = () => setStep(Math.max(0, step - 1));

  const finish = () => {
    if (previewMode) {
      // Preview: never mark done, never mutate production keys. Just close cleanly.
      try { if (storageKey) localStorage.removeItem(storageKey); } catch {}
      onComplete?.();
      onOpenChange(false);
      return;
    }
    if (user) {
      localStorage.setItem(`glowsuite_onboarding_${user.id}`, "done");
      localStorage.setItem(`glowsuite_onboarding_v4_${user.id}`, "done");
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
    if (!previewMode && user) {
      localStorage.setItem(`glowsuite_onboarding_${user.id}`, "skipped");
      localStorage.setItem(`glowsuite_onboarding_v4_${user.id}`, "skipped");
    }
    onOpenChange(false);
  };

  const canProceed = step !== 1 || Boolean(data.salonType && data.salonName.trim());
  const primaryLabel =
    step === 0 ? "Beginnen"
    : step === TOTAL - 1 ? "Start met GlowSuite"
    : "Volgende";

  const showChrome = !data.postWelcome;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-full sm:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[92vh] p-0 gap-0 overflow-hidden border-0 sm:border rounded-none sm:rounded-2xl flex flex-col [&>button:last-child]:top-3 [&>button:last-child]:right-3 [&>button:last-child]:flex [&>button:last-child]:h-11 [&>button:last-child]:w-11 [&>button:last-child]:items-center [&>button:last-child]:justify-center sm:[&>button:last-child]:top-4 sm:[&>button:last-child]:right-4 sm:[&>button:last-child]:h-4 sm:[&>button:last-child]:w-4">
        <DialogTitle className="sr-only">GlowSuite instellen</DialogTitle>
        <DialogDescription className="sr-only">Vul je salon in. Extra instellingen zijn optioneel.</DialogDescription>
        {/* Header */}
        {showChrome && (
          <div className="px-5 sm:px-8 pt-5 sm:pt-6 pb-3 border-b border-border/50 bg-gradient-to-br from-primary/[0.04] to-transparent">
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between mb-3 pr-12 sm:pr-6">
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 min-w-0">
                {data.logoUrl ? (
                  <img
                    src={data.logoUrl}
                    alt={data.salonName || "Salonlogo"}
                    className="w-7 h-7 shrink-0 rounded-lg object-cover border border-border/50 bg-background"
                  />
                ) : (
                  <img
                    src={glowsuiteLogo}
                    alt="GlowSuite"
                    className="w-7 h-7 shrink-0 rounded-lg object-contain bg-background"
                  />
                )}
                <span className="text-sm font-semibold">{data.logoUrl && data.salonName ? data.salonName : "GlowSuite"}</span>
                {previewMode && (
                  <>
                    <span className="shrink-0 px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px] font-medium">
                      Voorbeeld
                    </span>
                    <span className="basis-full sm:basis-auto text-[10px] text-muted-foreground/80">
                      Wijzigingen worden niet opgeslagen.
                    </span>
                  </>
                )}
              </div>
              {step > 0 && step < TOTAL - 1 && (
                <div className={cn("flex flex-col items-end self-end shrink-0", "hidden sm:flex")}>
                  <Button variant="ghost" size="sm" onClick={skipAll} disabled={saving} className="text-xs text-muted-foreground">
                    Nu sluiten
                  </Button>
                  <span className="text-[10px] text-muted-foreground/70 text-right max-w-36">Verder via Instellingen › Snelle setup</span>
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
              {step === 2 && <GlowPayStep demo={demoMode} previewMode={previewMode} salonName={data.salonName} onLater={() => next()} />}
              {step === 3 && <TerminalStep previewMode={previewMode} />}
              {step === 4 && <SystemCheckStep />}
              {step === 5 && <AutomationsStep data={data} setData={setData} />}
              {step === 6 && <DoneStep logoUrl={data.logoUrl} salonName={data.salonName} />}
            </>
          )}
        </div>

        {/* Footer */}
        {showChrome && (
          <div className="px-5 sm:px-8 py-4 border-t border-border/50 bg-background flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={back} disabled={saving || step === 0}>
              <ArrowLeft className="w-4 h-4" /> Terug
            </Button>
            <div className="flex flex-col-reverse sm:flex-row gap-2 min-w-0">
              <Button variant="gradient" size="sm" onClick={() => next()} disabled={saving || !canProceed}>
                {saving ? "Bezig..." : primaryLabel}
                {!saving && <ArrowRight className="w-4 h-4" />}
              </Button>
            </div>
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
      <img
        src={glowsuiteLogo}
        alt="GlowSuite"
        className="w-20 h-20 rounded-3xl object-contain mb-6 shadow-elegant bg-background"
      />
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">Welkom bij GlowSuite</h1>
      <p className="text-base text-muted-foreground mb-6">
        Vul je salonnaam in en kies je salontype. Betalingen en berichten kun je later instellen.
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
        <p className="text-sm text-muted-foreground mt-1">Kies je salontype voor passende standaardbehandelingen.</p>
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
          <Label htmlFor="onboarding-salon-name">Hoe heet jouw salon?</Label>
          <Input
            id="onboarding-salon-name"
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

const PAY_LABEL: Record<PayStatus, string> = {
  not_started: "Niet gestart",
  pending: "In behandeling",
  action_needed: "Actie nodig",
  active: "Actief",
};
const PAY_TEXT: Record<PayStatus, string> = {
  not_started: "Je kunt GlowPay activeren wanneer het jou uitkomt.",
  pending: "Je registratie is nog niet bevestigd als afgerond. Controleer bij Viva of je nog stappen moet afronden.",
  action_needed: "Ga verder met de verificatie bij Viva om betalingen te ontvangen.",
  active: "Je betaalaccount is goedgekeurd. Betalingen zijn beschikbaar.",
};

function GlowPayStep({ demo, previewMode = false, salonName, onLater }: { demo: boolean; previewMode?: boolean; salonName: string; onLater: () => void }) {
  const { user } = useAuth();
  const [pay, setPay] = useState<PayStatus | null>(null);
  const [booking, setBooking] = useState<BookingStatus | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const inviteFlight = useRef(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [m, s] = await Promise.all([
        (supabase as any).from("glowpay_connected_merchants")
          .select("viva_account_id, viva_merchant_id, onboarding_status, kyc_status, online_payments_enabled, viva_source_code, is_demo")
          .eq("user_id", user.id).eq("is_demo", demo).maybeSingle(),
        (supabase as any).from("settings").select("public_slug").eq("user_id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      setPay(m.error ? null : glowpayPaymentStatus(m.data ?? null));
      setBooking(s.error ? null : bookingStatus(s.data?.public_slug));
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id, demo]);

  const status: PayStatus = pay ?? "not_started";
  const tone = (ok: boolean) => ok ? "text-success" : "text-muted-foreground";

  // Alleen interactief voor een ingelogde, niet-demo gebruiker buiten preview.
  const canInvite = Boolean(user && !demo && !previewMode && salonName.trim() && user.email);

  const startVivaInvite = async () => {
    // Single-flight: nooit twee registratieverzoeken tegelijk of na elkaar
    // automatisch herhalen. Alleen een expliciete nieuwe klik mag opnieuw.
    if (!canInvite || inviteFlight.current) return;
    inviteFlight.current = true;
    setInviteBusy(true);
    setInviteMsg(null);
    const forUserId = user!.id;
    try {
      const { data: res, error } = await supabase.functions.invoke("create-viva-connected-account", {
        body: { business_name: salonName.trim(), contact_email: user!.email, country: "NL" },
      });
      // Gebruiker is tijdens het wachten gewisseld: nooit met een vorige
      // gebruikers-URL navigeren of status tonen.
      if (user?.id !== forUserId) return;
      const action = error
        ? inviteActionFromError(error)
        : inviteActionFromResponse((res as any) ?? {});
      if (action.kind === "navigate") {
        // Zelfde tabblad; de wizard-stap is al in localStorage bewaard en Viva
        // stuurt na afronden terug naar /glowpay/registratie-status.
        window.location.assign(action.url);
        return;
      }
      setInviteMsg(action.text);
    } catch (e) {
      if (user?.id !== forUserId) return;
      setInviteMsg(inviteActionFromError(e).kind === "message" ? (inviteActionFromError(e) as any).text : INVITE_UNAVAILABLE);
    } finally {
      inviteFlight.current = false;
      setInviteBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-lg mx-auto" data-testid="glowpay-step">
      <div className="space-y-3">
        <img src={glowpayLogo.url} alt="GlowPay" width={1470} height={335} className="h-auto w-44 max-w-full rounded-md object-contain" />
        <h2 className="text-2xl font-bold tracking-tight">Activeer GlowPay</h2>
        <p className="text-sm text-muted-foreground">
          GlowPay is de betaaloplossing van GlowSuite.
          Je maakt zelf een account aan bij onze betaalpartner Viva, of je koppelt je bestaande Viva-account.
          Viva controleert je bedrijfsgegevens. Dat is een aparte stap en kan even duren.
          GlowSuite kun je ondertussen gewoon gebruiken.
        </p>
      </div>

      <div className="rounded-2xl border border-border divide-y divide-border">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm">Online boeken</span>
          <span className={cn("text-sm font-medium", tone(booking === "active"))}>
            {booking === null ? "…" : booking === "active" ? "Ingesteld" : "Nog niet ingesteld"}
          </span>
        </div>
        <div className="px-4 py-3 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">GlowPay-betalingen</span>
            <span className={cn("text-sm font-medium", tone(status === "active"))} data-testid="glowpay-pay-status">
              {pay === null ? "…" : PAY_LABEL[status]}
            </span>
          </div>
          {pay !== null && <p className="text-xs text-muted-foreground">{PAY_TEXT[status]}</p>}
        </div>
      </div>

      {status !== "active" && (
        <div className="space-y-2">
          <Button variant="outline" className="w-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none" disabled aria-describedby="glowpay-soon">
            <LockKeyhole aria-hidden="true" />
            Activeer GlowPay via Viva
          </Button>
          <p id="glowpay-soon" className="text-xs text-muted-foreground text-center">
            {demo
              ? "In de demo kun je GlowPay niet activeren. Er worden geen echte betalingen verwerkt."
              : "Activeren is beschikbaar zodra de partnerkoppeling met Viva gereed is."}
          </p>
          <Button variant="ghost" className="w-full" onClick={onLater}>Later activeren</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground text-center">GlowPay is optioneel. Online boeken werkt ook zonder.</p>
    </div>
  );
}

function friendlyTerminalError(err: any): string {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "");
  if (code === "23505" || msg.includes("duplicate key") || msg.includes("unique constraint")) {
    return "Deze terminal is al gekoppeld.";
  }
  return "De terminal kon niet worden opgeslagen. Probeer het opnieuw.";
}

function TerminalStep({ previewMode = false }: { previewMode?: boolean }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const [existing, setExisting] = useState<any | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"choice" | "have" | "none" | "skipped" | "success">("choice");

  // Form fields for "have terminal"
  const [tname, setTname] = useState("");
  const [tid, setTid] = useState("");
  const [tsource, setTsource] = useState("");
  const [tvirtual, setTvirtual] = useState("");
  const [tserial, setTserial] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) { setLoaded(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from("viva_terminals")
          .select("id, terminal_name, terminal_id, is_default")
          .eq("user_id", user.id)
          .eq("is_demo", demoMode)
          .order("is_default", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancelled) {
          if (data) { setExisting(data); setMode("success"); }
          setLoaded(true);
        }
      } catch { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [user, demoMode]);

  const save = async () => {
    setFormError(null);
    const name = tname.trim();
    const id = tid.replace(/\s+/g, "");
    if (!id) { setFormError("Vul een Terminal ID in."); return; }
    if (!name) { setFormError("Geef de terminal een naam."); return; }

    if (previewMode) {
      toast.success("Voorbeeld: terminal zou worden gekoppeld");
      setMode("success");
      return;
    }
    if (!user) return;
    setSaving(true);
    try {
      const { data: dup } = await (supabase as any)
        .from("viva_terminals")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_demo", demoMode)
        .eq("terminal_id", id)
        .maybeSingle();
      if (dup) { setFormError("Deze terminal is al gekoppeld."); return; }

      const { data: inserted, error } = await (supabase.from("viva_terminals") as any).insert({
        user_id: user.id, is_demo: demoMode, terminal_id: id, terminal_name: name,
        source_terminal_id: tsource.trim() || null,
        virtual_id: tvirtual.trim() || null,
        serial_number: tserial.trim() || null,
        status: "active", is_default: true,
      }).select("id, terminal_name, terminal_id").maybeSingle();
      if (error) { setFormError(friendlyTerminalError(error)); return; }
      setExisting(inserted);
      setMode("success");
      toast.success("Terminal gekoppeld");
    } finally {
      setSaving(false);
    }
  };

  const goManage = () => navigate("/instellingen?tab=glowpay#terminals");

  if (!loaded) {
    return (
      <div className="max-w-lg mx-auto py-8 flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Laden…
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Koppel je pinautomaat</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {mode === "success"
            ? "De terminalgegevens zijn opgeslagen. Controleer de verbinding via GlowPay."
            : mode === "skipped"
            ? "Je kunt dit later instellen. We slaan deze stap over."
            : "Heb je al een Sunmi-terminal?"}
        </p>
      </div>

      {mode === "success" && (
        <>
          <div className="p-5 rounded-2xl border border-success/30 bg-success/5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
                <Check className="w-5 h-5 text-success" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold">Terminal gekoppeld</p>
                <p className="text-xs text-muted-foreground truncate">
                  {existing?.terminal_name || "Terminal"}
                  {existing?.terminal_id ? ` · ${existing.terminal_id}` : ""}
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button variant="outline" size="sm" onClick={goManage}>
              Terminal beheren
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setExisting(null); setMode("have"); }}>
              Andere terminal koppelen
            </Button>
          </div>
        </>
      )}

      {mode === "skipped" && (
        <div className="p-5 rounded-2xl border border-border bg-secondary/30 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
            <Smartphone className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm">Later instellen</p>
            <p className="text-xs text-muted-foreground">Je kunt dit altijd doen via Instellingen › GlowPay.</p>
          </div>
        </div>
      )}

      {mode === "choice" && (
        <>
          <div className="p-5 rounded-2xl border border-border bg-secondary/30">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold">Sunmi & Viva Smart Checkout</p>
                <p className="text-xs text-muted-foreground">Je kunt deze stap overslaan en later instellen.</p>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Button variant="gradient" size="sm" className="w-full" onClick={() => setMode("have")}>
              Ik heb al een terminal
            </Button>
            <Button variant="outline" size="sm" className="w-full" onClick={() => setMode("none")}>
              Ik heb nog geen terminal
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setMode("skipped")}
            className="text-[11px] text-muted-foreground hover:text-foreground w-full text-center"
          >
            Ik stel dit later in.
          </button>
        </>
      )}

      {mode === "have" && (
        <div className="space-y-3 p-4 rounded-2xl border border-border bg-background">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Terminalgegevens</p>
            <button type="button" onClick={() => { setFormError(null); setMode("choice"); }} className="text-xs text-muted-foreground hover:text-foreground">
              Terug
            </button>
          </div>
          <div className="space-y-2.5">
            <div>
              <Label className="text-xs">Naam van de terminal</Label>
              <Input value={tname} onChange={e => setTname(e.target.value)} placeholder="Balie voor" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Terminal ID</Label>
              <Input value={tid} onChange={e => setTid(e.target.value)} placeholder="16000000" className="mt-1 font-mono" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Source Terminal ID</Label>
                <Input value={tsource} onChange={e => setTsource(e.target.value)} placeholder="optioneel" className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs">Virtual ID</Label>
                <Input value={tvirtual} onChange={e => setTvirtual(e.target.value)} placeholder="optioneel" className="mt-1 font-mono" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Serienummer</Label>
              <Input value={tserial} onChange={e => setTserial(e.target.value)} placeholder="optioneel" className="mt-1 font-mono" />
            </div>
          </div>
          {formError && (
            <p className="text-xs text-destructive">{formError}</p>
          )}
          {previewMode && (
            <p className="text-[11px] text-muted-foreground">Voorbeeldmodus: wijzigingen worden niet opgeslagen.</p>
          )}
          <Button variant="gradient" size="sm" className="w-full" onClick={save} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {saving ? "Opslaan…" : "Terminal koppelen"}
          </Button>
        </div>
      )}

      {mode === "none" && (
        <div className="space-y-2">
          <Button variant="outline" size="sm" className="w-full" onClick={goManage}>
            Bekijk ondersteunde terminals
          </Button>
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setMode("skipped")}>
            Ga verder zonder terminal
          </Button>
          <button
            type="button"
            onClick={() => setMode("choice")}
            className="text-[11px] text-muted-foreground hover:text-foreground w-full text-center pt-1"
          >
            Terug
          </button>
        </div>
      )}
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
        <p className="text-sm text-muted-foreground mt-1">Deze controle bevestigt niet dat betalingen of berichten actief zijn.</p>
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
                  {r.key === "agenda" || r.key === "db" ? <><Check className="w-4 h-4" /> Bereikbaar</> : "Niet bevestigd"}
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
          <span className="font-medium">Controle afgerond. Betaalstatus is niet bevestigd.</span>
        </div>
      )}
      {demoMode && (
        <p className="text-xs text-muted-foreground text-center">
          Controleer de testinstellingen via GlowPay voordat je oefent.
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
        <span>Controleer de koppelingen voordat je automatische berichten gebruikt.</span>
      </div>
    </div>
  );
}

function DoneStep({ logoUrl, salonName }: { logoUrl?: string; salonName?: string }) {
  // Alleen wat deze wizard daadwerkelijk heeft geregeld. Betalingen en automatische
  // berichten vereisen een aparte koppeling en krijgen hier daarom geen vinkje.
  const ready = ["Agenda", "Klantenbestand", "Standaardbehandelingen", "Dashboard"];
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-6 sm:py-10 max-w-md mx-auto">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={salonName || "Salonlogo"}
          className="w-20 h-20 rounded-3xl object-cover mb-6 shadow-elegant border border-border/50 bg-background"
        />
      ) : (
        <img
          src={glowsuiteLogo}
          alt="GlowSuite"
          className="w-20 h-20 rounded-3xl object-contain mb-6 shadow-elegant bg-background"
        />
      )}
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">Je salon is klaar!</h1>
      <p className="text-base text-muted-foreground mb-6">
        De inrichting van GlowSuite is afgerond. Je kunt nu aan de slag met:
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full text-left">
        {ready.map(t => (
          <div key={t} className="flex min-w-0 items-center gap-2 px-3 py-2 rounded-lg bg-secondary/40 border border-border/50">
            <Check className="w-4 h-4 text-success shrink-0" />
            <span className="min-w-0 break-words text-sm font-medium">{t}</span>
          </div>
        ))}
      </div>
      <div className="w-full mt-4 rounded-2xl border border-border/60 bg-secondary/20 px-4 py-3 text-left">
        <p className="text-sm font-semibold">Later instellen</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          GlowPay-betalingen rond je apart af bij Viva. Dat is een eigen stap met verificatie en die gaat niet vanzelf.
          Automatische berichten regel je via Instellingen, wanneer het je uitkomt.
        </p>
      </div>
    </div>
  );
}


function PostWelcomeStep({ onNavigate }: { onNavigate: (path: string) => void }) {
  const actions = [
    { icon: Calendar, label: "Eerste afspraak maken", emoji: "📅", path: "/agenda?nieuw=1" },
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
        Extra instellingen vind je later via Instellingen en GlowPay.
      </p>
    </div>
  );
}

