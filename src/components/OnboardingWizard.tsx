import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCrud } from "@/hooks/useCrud";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, Check, ArrowRight, ArrowLeft, Store, Scissors, Users,
  Globe, CreditCard, Rocket, Copy, Upload, PartyPopper, SkipForward,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onComplete?: () => void;
}

const DEMO_SERVICES = [
  { name: "Knippen dames", duration_minutes: 45, price: 45, color: "#7B61FF" },
  { name: "Knippen heren", duration_minutes: 30, price: 28, color: "#5B8DFF" },
  { name: "Kleuren", duration_minutes: 90, price: 75, color: "#C850C0" },
  { name: "Föhnen", duration_minutes: 30, price: 25, color: "#FF61B4" },
];

type Progress = {
  step: number;
  salon: { name: string; phone: string; address: string; logoUrl: string };
  services: { name: string; price: string; duration: string }[];
  team: { name: string; hours: string }[];
};

const EMPTY: Progress = {
  step: -1,
  salon: { name: "", phone: "", address: "", logoUrl: "" },
  services: [{ name: "", price: "", duration: "30" }],
  team: [{ name: "", hours: "Ma-Vr 09:00-18:00" }],
};

export function OnboardingWizard({ open, onOpenChange, onComplete }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const servicesCrud = useCrud("services");
  const customersCrud = useCrud("customers");

  const storageKey = user ? `glowsuite_onboarding_v2_${user.id}` : "";
  const [data, setData] = useState<Progress>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [bookingLink, setBookingLink] = useState("");

  // Load saved progress
  useEffect(() => {
    if (!storageKey || !open) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setData({ ...EMPTY, ...JSON.parse(raw) });
    } catch {}
  }, [storageKey, open]);

  // Auto-save progress
  useEffect(() => {
    if (!storageKey || !open) return;
    try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch {}
  }, [data, storageKey, open]);

  // Prefill salon name from profile
  useEffect(() => {
    if (!user || !open || data.salon.name) return;
    (async () => {
      const { data: p } = await supabase.from("profiles").select("salon_name").eq("user_id", user.id).maybeSingle();
      if (p?.salon_name && p.salon_name !== "Mijn Salon") {
        setData(d => ({ ...d, salon: { ...d.salon, name: p.salon_name as string } }));
      }
    })();
  }, [user, open]);

  const setStep = (s: number) => setData(d => ({ ...d, step: s }));
  const totalSteps = 5;
  const stepIdx = Math.max(0, data.step);
  const pct = data.step < 0 ? 0 : ((data.step + 1) / totalSteps) * 100;

  const STEPS = [
    { id: 0, label: "Salon", icon: Store },
    { id: 1, label: "Diensten", icon: Scissors },
    { id: 2, label: "Team", icon: Users },
    { id: 3, label: "Online", icon: Globe },
    { id: 4, label: "Betalen", icon: CreditCard },
  ];

  // ------- Logo upload -------
  const onLogoUpload = async (file: File) => {
    if (!user) return;
    const ext = file.name.split(".").pop() || "png";
    const path = `${user.id}/logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("salon-logos").upload(path, file, { upsert: true });
    if (error) { toast.error("Logo upload mislukt: " + error.message); return; }
    const { data: pub } = supabase.storage.from("salon-logos").getPublicUrl(path);
    setData(d => ({ ...d, salon: { ...d.salon, logoUrl: pub.publicUrl } }));
    toast.success("Logo geüpload");
  };

  // ------- Save salon -------
  const saveSalon = async () => {
    if (!user) return;
    await supabase.from("profiles").update({ salon_name: data.salon.name.trim() || "Mijn Salon" }).eq("user_id", user.id);
    // settings update (best-effort)
    const { data: s } = await supabase.from("settings").select("id").eq("user_id", user.id).eq("is_demo", false).maybeSingle();
    if (s?.id) {
      await (supabase.from("settings") as any).update({
        salon_name: data.salon.name.trim() || "Mijn Salon",
        salon_phone: data.salon.phone || null,
        salon_address: data.salon.address || null,
        salon_logo_url: data.salon.logoUrl || null,
      }).eq("id", s.id);
    }
  };

  const useDemoData = () => {
    setData(d => ({
      ...d,
      services: DEMO_SERVICES.map(s => ({ name: s.name, price: String(s.price), duration: String(s.duration_minutes) })),
    }));
    toast.success("Demo diensten geladen");
  };

  const saveServices = async () => {
    const valid = data.services.filter(s => s.name.trim());
    for (const s of valid) {
      await servicesCrud.insert({
        name: s.name.trim(),
        price: Number(s.price) || 0,
        duration_minutes: Number(s.duration) || 30,
        is_active: true,
        is_online_bookable: true,
        color: "#7B61FF",
      });
    }
  };

  const saveTeam = async () => {
    const valid = data.team.filter(t => t.name.trim());
    for (const t of valid) {
      await customersCrud.insert({
        name: `Medewerker: ${t.name.trim()}`,
        notes: `Werktijden: ${t.hours}`,
      });
    }
  };

  const next = async () => {
    setSaving(true);
    try {
      if (data.step === 0) await saveSalon();
      if (data.step === 1) await saveServices();
      if (data.step === 2) await saveTeam();
      if (data.step === 3) {
        const link = `${window.location.origin}/book/${user?.id}`;
        setBookingLink(link);
      }
      if (data.step === 4) {
        finish();
        return;
      }
      setStep(data.step + 1);
    } catch (e: any) {
      toast.error("Er ging iets mis: " + (e?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const back = () => setStep(Math.max(-1, data.step - 1));
  const skipStep = () => {
    if (data.step === 4) { finish(); return; }
    if (data.step === 3 && !bookingLink && user) setBookingLink(`${window.location.origin}/book/${user.id}`);
    setStep(data.step + 1);
  };

  const finish = () => {
    if (user) {
      localStorage.setItem(`glowsuite_onboarding_${user.id}`, "done");
      localStorage.removeItem(storageKey);
    }
    if (!bookingLink && user) setBookingLink(`${window.location.origin}/book/${user.id}`);
    setDone(true);
    onComplete?.();
  };

  const close = () => {
    onOpenChange(false);
    setTimeout(() => { setDone(false); }, 300);
  };

  const skipAll = () => {
    if (user) localStorage.setItem(`glowsuite_onboarding_${user.id}`, "skipped");
    close();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(bookingLink);
      toast.success("Boekingslink gekopieerd");
    } catch { toast.error("Kopiëren mislukt"); }
  };

  const connectMollie = async () => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessie verlopen");
      const { data: res, error } = await supabase.functions.invoke("mollie-connect", {
        body: { action: "start", redirect_to: window.location.origin + "/instellingen" },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error || res?.error) throw new Error(res?.error || error?.message);
      if (res?.url) window.location.href = res.url;
    } catch (e: any) {
      toast.error("Mollie koppelen mislukt: " + (e?.message || ""));
    } finally { setSaving(false); }
  };

  // ============ RENDER ============
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-full sm:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[92vh] p-0 gap-0 overflow-hidden border-0 sm:border rounded-none sm:rounded-2xl flex flex-col">
        {/* Header */}
        {!done && (
          <div className="px-5 sm:px-8 pt-5 sm:pt-6 pb-3 border-b border-border/50 bg-gradient-to-br from-primary/[0.04] to-transparent">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="text-sm font-semibold">GlowSuite</span>
              </div>
              {data.step >= 0 && (
                <button onClick={skipAll} className="text-xs text-muted-foreground hover:text-foreground">
                  Later afmaken
                </button>
              )}
            </div>
            {data.step >= 0 && (
              <>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Stap {data.step + 1} van {totalSteps} — {STEPS[stepIdx].label}
                  </p>
                  <p className="text-xs font-semibold text-primary">{Math.round(pct)}%</p>
                </div>
                <Progress value={pct} className="h-1.5" />
              </>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-6 sm:py-8">
          {done ? (
            <DoneScreen bookingLink={bookingLink} onCopy={copyLink} onDashboard={() => { close(); navigate("/"); }} onImport={() => { close(); navigate("/klanten"); }} />
          ) : data.step < 0 ? (
            <WelcomeScreen onStart={() => setStep(0)} />
          ) : data.step === 0 ? (
            <SalonStep data={data} setData={setData} onLogo={onLogoUpload} />
          ) : data.step === 1 ? (
            <ServicesStep data={data} setData={setData} onDemo={useDemoData} />
          ) : data.step === 2 ? (
            <TeamStep data={data} setData={setData} />
          ) : data.step === 3 ? (
            <OnlineStep bookingLink={bookingLink || (user ? `${window.location.origin}/book/${user.id}` : "")} onCopy={copyLink} />
          ) : (
            <PaymentsStep onConnect={connectMollie} loading={saving} />
          )}
        </div>

        {/* Footer */}
        {!done && data.step >= 0 && (
          <div className="px-5 sm:px-8 py-4 border-t border-border/50 bg-background flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={back} disabled={saving}>
              <ArrowLeft className="w-4 h-4" /> Terug
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={skipStep} disabled={saving} className="text-muted-foreground">
                <SkipForward className="w-3.5 h-3.5" /> Overslaan
              </Button>
              <Button variant="gradient" size="sm" onClick={next} disabled={saving}>
                {saving ? "Bezig..." : data.step === 4 ? "Afronden" : "Volgende"}
                {!saving && <ArrowRight className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============ SUB COMPONENTS ============

function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-8 sm:py-12 max-w-md mx-auto">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center mb-6 shadow-elegant">
        <Rocket className="w-10 h-10 text-primary-foreground" />
      </div>
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">Welkom bij GlowSuite</h1>
      <p className="text-base text-muted-foreground mb-2">Je proefperiode loopt 14 dagen.</p>
      <p className="text-base text-muted-foreground mb-8">Laten we je salon binnen <span className="text-foreground font-semibold">5 minuten</span> live zetten.</p>
      <div className="grid grid-cols-2 gap-2 w-full mb-8 text-left">
        {[
          { i: Store, t: "Salon profiel" },
          { i: Scissors, t: "Diensten" },
          { i: Users, t: "Team" },
          { i: Globe, t: "Online boekingen" },
        ].map(({ i: Icon, t }) => (
          <div key={t} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary/40 border border-border/50">
            <Icon className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">{t}</span>
          </div>
        ))}
      </div>
      <Button variant="gradient" size="lg" className="w-full" onClick={onStart}>
        Start installatie <ArrowRight className="w-4 h-4" />
      </Button>
      <p className="text-[11px] text-muted-foreground mt-4">Je voortgang wordt automatisch opgeslagen</p>
    </div>
  );
}

function SalonStep({ data, setData, onLogo }: any) {
  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Vertel over je salon</h2>
        <p className="text-sm text-muted-foreground mt-1">Deze gegevens zien klanten in bevestigingen.</p>
      </div>
      <div className="space-y-4">
        <div>
          <Label>Salonnaam</Label>
          <Input value={data.salon.name} onChange={e => setData({ ...data, salon: { ...data.salon, name: e.target.value } })} placeholder="Studio Nova" className="mt-1.5" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Telefoon</Label>
            <Input value={data.salon.phone} onChange={e => setData({ ...data, salon: { ...data.salon, phone: e.target.value } })} placeholder="+31 6 1234 5678" className="mt-1.5" />
          </div>
          <div>
            <Label>Adres</Label>
            <Input value={data.salon.address} onChange={e => setData({ ...data, salon: { ...data.salon, address: e.target.value } })} placeholder="Hoofdstraat 1, Amsterdam" className="mt-1.5" />
          </div>
        </div>
        <div>
          <Label>Logo (optioneel)</Label>
          <label className="mt-1.5 flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors">
            {data.salon.logoUrl ? (
              <img src={data.salon.logoUrl} alt="Logo" className="w-10 h-10 rounded-lg object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                <Upload className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            <span className="text-sm text-muted-foreground flex-1">{data.salon.logoUrl ? "Logo gewijzigd. Klik om te vervangen." : "Sleep of klik om te uploaden"}</span>
            <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && onLogo(e.target.files[0])} />
          </label>
        </div>
      </div>
    </div>
  );
}

function ServicesStep({ data, setData, onDemo }: any) {
  const update = (i: number, key: string, val: string) => {
    const list = [...data.services];
    list[i] = { ...list[i], [key]: val };
    setData({ ...data, services: list });
  };
  const addRow = () => setData({ ...data, services: [...data.services, { name: "", price: "", duration: "30" }] });
  const removeRow = (i: number) => setData({ ...data, services: data.services.filter((_: any, idx: number) => idx !== i) });

  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Voeg diensten toe</h2>
          <p className="text-sm text-muted-foreground mt-1">Wat bied je aan? Je kunt dit later aanvullen.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onDemo}>Gebruik demo data</Button>
      </div>
      <div className="space-y-2">
        {data.services.map((s: any, i: number) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <Input className="col-span-6" placeholder="Naam dienst" value={s.name} onChange={e => update(i, "name", e.target.value)} />
            <Input className="col-span-3" type="number" placeholder="€" value={s.price} onChange={e => update(i, "price", e.target.value)} />
            <Input className="col-span-2" type="number" placeholder="min" value={s.duration} onChange={e => update(i, "duration", e.target.value)} />
            <button onClick={() => removeRow(i)} className="col-span-1 text-muted-foreground hover:text-destructive text-lg">×</button>
          </div>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={addRow}>+ Dienst toevoegen</Button>
    </div>
  );
}

function TeamStep({ data, setData }: any) {
  const update = (i: number, key: string, val: string) => {
    const list = [...data.team];
    list[i] = { ...list[i], [key]: val };
    setData({ ...data, team: list });
  };
  const addRow = () => setData({ ...data, team: [...data.team, { name: "", hours: "Ma-Vr 09:00-18:00" }] });
  const removeRow = (i: number) => setData({ ...data, team: data.team.filter((_: any, idx: number) => idx !== i) });

  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Wie werkt er bij je salon?</h2>
        <p className="text-sm text-muted-foreground mt-1">Voeg jezelf en collega's toe met werktijden.</p>
      </div>
      <div className="space-y-2">
        {data.team.map((t: any, i: number) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <Input className="col-span-5" placeholder="Naam medewerker" value={t.name} onChange={e => update(i, "name", e.target.value)} />
            <Input className="col-span-6" placeholder="Werktijden" value={t.hours} onChange={e => update(i, "hours", e.target.value)} />
            <button onClick={() => removeRow(i)} className="col-span-1 text-muted-foreground hover:text-destructive text-lg">×</button>
          </div>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={addRow}>+ Medewerker toevoegen</Button>
    </div>
  );
}

function OnlineStep({ bookingLink, onCopy }: { bookingLink: string; onCopy: () => void }) {
  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Zet online boekingen live</h2>
        <p className="text-sm text-muted-foreground mt-1">Deel deze link op je website, Instagram of Google.</p>
      </div>
      <div className="p-4 rounded-xl border border-border bg-secondary/30">
        <p className="text-xs text-muted-foreground mb-2">Jouw boekingslink</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm font-mono px-3 py-2 rounded-lg bg-background border border-border overflow-x-auto whitespace-nowrap">{bookingLink}</code>
          <Button size="sm" variant="outline" onClick={onCopy}><Copy className="w-3.5 h-3.5" /></Button>
        </div>
      </div>
      <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
        <p className="text-sm font-semibold mb-1 flex items-center gap-2"><Globe className="w-4 h-4 text-primary" /> Widget voor je website</p>
        <p className="text-xs text-muted-foreground">Plak één regel HTML op je website voor een ingebouwde booking-widget. Beschikbaar onder Instellingen → Widget.</p>
      </div>
    </div>
  );
}

function PaymentsStep({ onConnect, loading }: { onConnect: () => void; loading: boolean }) {
  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Activeer betalingen</h2>
        <p className="text-sm text-muted-foreground mt-1">Ontvang aanbetalingen en online betalingen via Mollie.</p>
      </div>
      <div className="p-5 rounded-2xl border border-border bg-gradient-to-br from-primary/5 to-transparent">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <CreditCard className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold">Mollie koppeling</p>
            <p className="text-xs text-muted-foreground">iDEAL, Bancontact, kaart en meer</p>
          </div>
        </div>
        <ul className="space-y-1.5 mb-4 text-sm">
          {["Aanbetalingen voor afspraken", "Webshop checkout", "Automatische incasso voor abonnementen"].map(t => (
            <li key={t} className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-success" /> {t}</li>
          ))}
        </ul>
        <Button variant="gradient" className="w-full" onClick={onConnect} disabled={loading}>
          {loading ? "Bezig..." : "Koppel Mollie"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground text-center">Je kan dit ook later in Instellingen activeren.</p>
    </div>
  );
}

function DoneScreen({ bookingLink, onCopy, onDashboard, onImport }: { bookingLink: string; onCopy: () => void; onDashboard: () => void; onImport: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-8 sm:py-12 max-w-md mx-auto">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-success to-success/70 flex items-center justify-center mb-6 shadow-elegant">
        <PartyPopper className="w-10 h-10 text-success-foreground" />
      </div>
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">Je salon staat live 🎉</h1>
      <p className="text-base text-muted-foreground mb-8">Klanten kunnen nu online afspraken maken. Wat wil je nu doen?</p>
      <div className="w-full space-y-2">
        <Button variant="gradient" size="lg" className="w-full" onClick={onDashboard}>
          Dashboard openen <ArrowRight className="w-4 h-4" />
        </Button>
        <Button variant="outline" size="lg" className="w-full" onClick={onCopy}>
          <Copy className="w-4 h-4" /> Boekingslink kopiëren
        </Button>
        <Button variant="ghost" size="lg" className="w-full" onClick={onImport}>
          Klanten importeren
        </Button>
      </div>
      {bookingLink && (
        <p className="text-[11px] text-muted-foreground mt-6 break-all">{bookingLink}</p>
      )}
    </div>
  );
}
