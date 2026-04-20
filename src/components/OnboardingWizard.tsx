import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useCrud } from "@/hooks/useCrud";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Scissors, Sparkles, Brush, Eye, Heart, Stethoscope, Check, ArrowRight, ArrowLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";

const SALON_TYPES = [
  {
    id: "kapsalon", label: "Kapsalon", icon: Scissors,
    services: [
      { name: "Knippen dames", duration_minutes: 45, price: 45, color: "#7B61FF" },
      { name: "Knippen heren", duration_minutes: 30, price: 28, color: "#5B8DFF" },
      { name: "Kleuren", duration_minutes: 90, price: 75, color: "#C850C0" },
      { name: "Föhnen", duration_minutes: 30, price: 25, color: "#FF61B4" },
    ],
  },
  {
    id: "nagelstudio", label: "Nagelstudio", icon: Sparkles,
    services: [
      { name: "Manicure", duration_minutes: 45, price: 35, color: "#FF61B4" },
      { name: "Gellak", duration_minutes: 60, price: 40, color: "#C850C0" },
      { name: "Acryl set", duration_minutes: 90, price: 55, color: "#7B61FF" },
      { name: "BIAB", duration_minutes: 75, price: 50, color: "#FF8FA3" },
    ],
  },
  {
    id: "barbershop", label: "Barbershop", icon: Brush,
    services: [
      { name: "Knippen", duration_minutes: 30, price: 25, color: "#5B8DFF" },
      { name: "Baard trimmen", duration_minutes: 20, price: 18, color: "#3B6BFF" },
      { name: "Knippen + baard", duration_minutes: 45, price: 38, color: "#7B61FF" },
      { name: "Hot towel shave", duration_minutes: 45, price: 35, color: "#1E3A8A" },
    ],
  },
  {
    id: "brow-lash", label: "Brow / Lash", icon: Eye,
    services: [
      { name: "Wenkbrauwen epileren", duration_minutes: 20, price: 18, color: "#C850C0" },
      { name: "Brow lift", duration_minutes: 45, price: 45, color: "#7B61FF" },
      { name: "Wimper extensions", duration_minutes: 90, price: 75, color: "#FF61B4" },
      { name: "Lash lift", duration_minutes: 60, price: 55, color: "#FF8FA3" },
    ],
  },
  {
    id: "beauty", label: "Beauty salon", icon: Heart,
    services: [
      { name: "Gezichtsbehandeling", duration_minutes: 60, price: 55, color: "#FF61B4" },
      { name: "Massage", duration_minutes: 60, price: 65, color: "#7B61FF" },
      { name: "Harsen", duration_minutes: 30, price: 25, color: "#C850C0" },
      { name: "Make-up", duration_minutes: 45, price: 45, color: "#FF8FA3" },
    ],
  },
  {
    id: "clinic", label: "Clinic / Aesthetics", icon: Stethoscope,
    services: [
      { name: "Botox consult", duration_minutes: 30, price: 0, color: "#5B8DFF" },
      { name: "Botox behandeling", duration_minutes: 45, price: 250, color: "#7B61FF" },
      { name: "Fillers", duration_minutes: 60, price: 350, color: "#C850C0" },
      { name: "Skin treatment", duration_minutes: 60, price: 150, color: "#FF61B4" },
    ],
  },
];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onComplete?: () => void;
}

export function OnboardingWizard({ open, onOpenChange, onComplete }: Props) {
  const { user } = useAuth();
  const services = useCrud("services");
  const settingsCrud = useCrud("settings");
  const profilesCrud = useCrud("profiles");
  const customersCrud = useCrud("customers");

  const [step, setStep] = useState(0);
  const [salonType, setSalonType] = useState<string>("");
  const [salonName, setSalonName] = useState("");
  const [firstEmployee, setFirstEmployee] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedType = SALON_TYPES.find(t => t.id === salonType);

  const close = () => {
    onOpenChange(false);
    setTimeout(() => setStep(0), 300);
  };

  const finish = async () => {
    if (!user || !selectedType) return;
    setSaving(true);
    try {
      // 1. Save salon name to profile
      if (salonName.trim()) {
        const { supabase } = await import("@/integrations/supabase/client");
        await supabase.from("profiles").update({ salon_name: salonName.trim() }).eq("user_id", user.id);
      }
      // 2. Insert default services
      for (const svc of selectedType.services) {
        await services.insert({ ...svc, is_active: true, is_online_bookable: true, category: selectedType.label });
      }
      // 3. First employee as customer placeholder (employee table not in scope)
      if (firstEmployee.trim()) {
        await customersCrud.insert({ name: `Medewerker: ${firstEmployee.trim()}`, notes: "Toegevoegd via onboarding" });
      }
      // 4. Mark onboarding complete in localStorage
      localStorage.setItem(`glowsuite_onboarding_${user.id}`, "done");
      toast.success("Je salon is klaar om boekingen te ontvangen 🎉");
      onComplete?.();
      close();
    } catch (e: any) {
      toast.error("Er ging iets mis: " + (e?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    if (user) localStorage.setItem(`glowsuite_onboarding_${user.id}`, "skipped");
    close();
  };

  const steps = ["Type", "Naam", "Team", "Klaar"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <div className="p-6 sm:p-8">
          {/* Progress */}
          <div className="flex items-center gap-2 mb-6">
            {steps.map((label, i) => (
              <div key={label} className="flex items-center gap-2 flex-1">
                <div className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0",
                  i < step ? "bg-success text-success-foreground" :
                  i === step ? "bg-primary text-primary-foreground" :
                  "bg-secondary text-muted-foreground"
                )}>
                  {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div className={cn("h-0.5 flex-1 rounded", i < step ? "bg-success" : "bg-border")} />
                )}
              </div>
            ))}
          </div>

          {/* Step 1: Type */}
          {step === 0 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Welk type salon heb je?</h2>
              <p className="text-sm text-muted-foreground mb-6">We stellen je salon in een minuut in met de juiste behandelingen.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                {SALON_TYPES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSalonType(t.id)}
                    className={cn(
                      "p-4 rounded-2xl border-2 text-left transition-all",
                      salonType === t.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    )}
                  >
                    <t.icon className={cn("w-6 h-6 mb-2", salonType === t.id ? "text-primary" : "text-muted-foreground")} />
                    <p className="text-sm font-semibold">{t.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{t.services.length} behandelingen</p>
                  </button>
                ))}
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={skip}>Overslaan</Button>
                <Button variant="gradient" disabled={!salonType} onClick={() => setStep(1)}>
                  Volgende <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Name */}
          {step === 1 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Hoe heet jouw salon?</h2>
              <p className="text-sm text-muted-foreground mb-6">Deze naam zien klanten in boekingen en bevestigingen.</p>
              <input
                autoFocus
                value={salonName}
                onChange={e => setSalonName(e.target.value)}
                placeholder="Bijv. Studio Nova Amsterdam"
                className="w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border text-base focus:outline-none focus:ring-2 focus:ring-primary/30 mb-6"
              />
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(0)}><ArrowLeft className="w-4 h-4" /> Terug</Button>
                <Button variant="gradient" disabled={!salonName.trim()} onClick={() => setStep(2)}>
                  Volgende <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Employee */}
          {step === 2 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Je eerste medewerker</h2>
              <p className="text-sm text-muted-foreground mb-6">Voeg jezelf of een collega toe. Dit kan later altijd uitgebreid worden.</p>
              <input
                autoFocus
                value={firstEmployee}
                onChange={e => setFirstEmployee(e.target.value)}
                placeholder="Naam medewerker (optioneel)"
                className="w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border text-base focus:outline-none focus:ring-2 focus:ring-primary/30 mb-6"
              />
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft className="w-4 h-4" /> Terug</Button>
                <Button variant="gradient" onClick={() => setStep(3)}>
                  Volgende <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Confirm */}
          {step === 3 && selectedType && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Klaar om te starten</h2>
              <p className="text-sm text-muted-foreground mb-6">Controleer je instellingen en open je salon.</p>
              <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50">
                  <span className="text-sm text-muted-foreground">Salon</span>
                  <span className="text-sm font-semibold">{salonName}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50">
                  <span className="text-sm text-muted-foreground">Type</span>
                  <span className="text-sm font-semibold">{selectedType.label}</span>
                </div>
                <div className="p-3 rounded-xl bg-secondary/50">
                  <p className="text-sm text-muted-foreground mb-2">Behandelingen ({selectedType.services.length})</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedType.services.map(s => (
                      <span key={s.name} className="text-xs px-2 py-1 rounded-md bg-primary/10 text-primary font-medium">
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
                {firstEmployee && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50">
                    <span className="text-sm text-muted-foreground">Medewerker</span>
                    <span className="text-sm font-semibold">{firstEmployee}</span>
                  </div>
                )}
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(2)} disabled={saving}><ArrowLeft className="w-4 h-4" /> Terug</Button>
                <Button variant="gradient" onClick={finish} disabled={saving}>
                  {saving ? "Opslaan..." : "Salon openen"} <Check className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
