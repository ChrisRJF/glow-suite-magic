import { useEffect, useMemo, useState } from "react";
import { services as fallbackServices, formatEuro } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Check, Clock, ArrowLeft, ArrowRight, Calendar, User, CreditCard, Loader2, Plus, Trash2, Users, Zap, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePaymentRules } from "@/hooks/usePaymentRules";
import { useServices, useSettings } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { queueLeadIntent } from "@/hooks/useLeadAutomation";
import { getBranding, applyBrandingToDocument, type WhiteLabelBranding } from "@/lib/whitelabel";

const availableSlots = ["09:00", "10:00", "11:30", "13:00", "14:30", "16:00", "17:00"];
const paymentMethods = [
  { id: "ideal", label: "iDEAL", icon: "🏦" },
  { id: "bancontact", label: "Bancontact", icon: "💳" },
  { id: "creditcard", label: "Creditcard", icon: "💳" },
  { id: "applepay", label: "Apple Pay", icon: "🍎" },
];

const EMPLOYEES = [
  { name: "Bas", role: "Kapper" },
  { name: "Roos", role: "Kapster" },
  { name: "Lisa", role: "Allround stylist" },
  { name: "Emma", role: "Junior stylist" },
];

const EMPLOYEE_CAPABILITIES: Record<string, string[]> = {
  Bas: ["Kinder knippen", "Heren knippen", "Heren baard trimmen", "Knippen"],
  Roos: ["Dames knippen", "Kleuren", "Knippen + föhnen", "Full balayage", "Balayage", "Uitgroei Bijwerken", "Keratine Behandeling"],
  Lisa: ["Kinder knippen", "Heren knippen", "Dames knippen", "Kleuren", "Knippen + föhnen", "Brow treatment", "Lash lift", "Manicure", "Knippen", "Föhnen & Stylen", "Balayage", "Uitgroei Bijwerken", "Diepteverzorging", "Opsteekkapsel"],
  Emma: ["Kinder knippen", "Knippen + föhnen", "Brow treatment", "BIAB behandeling", "Manicure", "Knippen", "Föhnen & Stylen", "Diepteverzorging", "Opsteekkapsel"],
};

type AssignmentMode = "manual" | "auto";

interface BookingServiceOption {
  id: string;
  name: string;
  duration: number;
  price: number;
  color?: string | null;
  description?: string | null;
}

interface GroupMember {
  id: string;
  name: string;
  serviceId: string;
  assignmentMode: AssignmentMode;
  assignedEmployee: string;
}

interface PlacementEntry {
  id: string;
  personLabel: string;
  employee: string;
  time: string;
  serviceName: string;
  assignmentMode: AssignmentMode;
}

interface PlacementOption {
  label: string;
  description: string;
  placements: PlacementEntry[];
}

export default function BookingPage() {
  const { data: liveServices } = useServices();
  const { data: liveSettings } = useSettings();
  const settingsRow = liveSettings[0] as any | undefined;
  const isDemoMode = Boolean(settingsRow?.demo_mode);
  const [step, setStep] = useState(1);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedMethod, setSelectedMethod] = useState("ideal");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentResult, setPaymentResult] = useState<{ status: string; message: string } | null>(null);
  const [isGroupBooking, setIsGroupBooking] = useState(false);
  const [mainAssignmentMode, setMainAssignmentMode] = useState<AssignmentMode>("auto");
  const [mainAssignedEmployee, setMainAssignedEmployee] = useState("");
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [placementOptions, setPlacementOptions] = useState<PlacementOption[]>([]);
  const [selectedPlacementIndex, setSelectedPlacementIndex] = useState(0);

  const bookingServices = useMemo<BookingServiceOption[]>(() => {
    if (liveServices.length > 0) {
      return liveServices
        .filter((service) => service.is_active && service.is_online_bookable && !service.is_internal_only)
        .map((service) => ({
          id: service.id,
          name: service.name,
          duration: service.duration_minutes,
          price: Number(service.price ?? 0),
          color: service.color,
          description: service.description,
        }));
    }

    return fallbackServices.map((service) => ({
      id: service.id,
      name: service.name,
      duration: service.duration,
      price: service.price,
      color: service.color,
      description: null,
    }));
  }, [liveServices]);

  useEffect(() => {
    if (selectedService && !bookingServices.some((service) => service.id === selectedService)) {
      setSelectedService(null);
    }

    setGroupMembers((current) =>
      current.map((member) =>
        bookingServices.some((service) => service.id === member.serviceId)
          ? member
          : { ...member, serviceId: bookingServices[0]?.id ?? "", assignedEmployee: "" }
      )
    );
  }, [bookingServices, selectedService]);

  // Auto-capture abandoned booking intents
  useEffect(() => {
    if (step >= 3 && (name.trim() || phone.trim())) {
      const svc = bookingServices.find((s) => s.id === selectedService);
      queueLeadIntent({
        name: name.trim() || undefined,
        phone: phone.trim() || undefined,
        service: svc?.name,
        intent_time: selectedTime || undefined,
      });
    }
  }, [step, name, phone, selectedService, selectedTime, bookingServices]);

  useEffect(() => {
    const handler = () => {
      if (step >= 2 && (name.trim() || phone.trim()) && !paymentResult) {
        const svc = bookingServices.find((s) => s.id === selectedService);
        queueLeadIntent({
          name: name.trim() || undefined,
          phone: phone.trim() || undefined,
          service: svc?.name,
          intent_time: selectedTime || undefined,
        });
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [step, name, phone, selectedService, selectedTime, paymentResult, bookingServices]);

  const service = bookingServices.find((item) => item.id === selectedService);

  const rules = usePaymentRules({
    deposit_new_client: settingsRow?.deposit_new_client ?? true,
    deposit_percentage: settingsRow?.deposit_percentage ?? 50,
    full_prepay_threshold: Number(settingsRow?.full_prepay_threshold) || 150,
    skip_prepay_vip: settingsRow?.skip_prepay_vip ?? false,
    deposit_noshow_risk: settingsRow?.deposit_noshow_risk ?? true,
    demo_mode: isDemoMode,
  });

  const totalPrice = useMemo(() => {
    let total = service?.price || 0;
    groupMembers.forEach((member) => {
      const memberService = bookingServices.find((item) => item.id === member.serviceId);
      total += memberService?.price || 0;
    });
    return total;
  }, [bookingServices, groupMembers, service]);

  const paymentDecision = totalPrice > 0 ? rules.decide(totalPrice, null, true) : null;
  const selectedPlacements = placementOptions[selectedPlacementIndex]?.placements ?? [];

  const resetPlacementOptions = () => {
    setPlacementOptions([]);
    setSelectedPlacementIndex(0);
  };

  const addGroupMember = () => {
    resetPlacementOptions();
    setGroupMembers((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: "",
        serviceId: bookingServices[0]?.id || "",
        assignmentMode: "auto",
        assignedEmployee: "",
      },
    ]);
  };

  const removeGroupMember = (id: string) => {
    resetPlacementOptions();
    setGroupMembers((prev) => prev.filter((member) => member.id !== id));
  };

  const updateGroupMember = (id: string, updates: Partial<GroupMember>) => {
    resetPlacementOptions();
    setGroupMembers((prev) => prev.map((member) => (member.id === id ? { ...member, ...updates } : member)));
  };

  const getEmployeesForService = (serviceId: string) => {
    const currentService = bookingServices.find((item) => item.id === serviceId);
    if (!currentService) return EMPLOYEES;

    const parsedFromDescription = currentService.description
      ?.match(/Medewerkers:\s*(.*)/i)?.[1]
      ?.split(",")
      .map((name) => name.trim())
      .filter(Boolean);

    if (parsedFromDescription && parsedFromDescription.length > 0) {
      const parsedEmployees = EMPLOYEES.filter((employee) => parsedFromDescription.includes(employee.name));
      if (parsedEmployees.length > 0) return parsedEmployees;
    }

    const fallbackEmployees = EMPLOYEES.filter((employee) =>
      EMPLOYEE_CAPABILITIES[employee.name]?.includes(currentService.name)
    );

    return fallbackEmployees.length > 0 ? fallbackEmployees : EMPLOYEES;
  };

  const buildPlacementOptions = () => {
    if (!selectedService || !selectedTime || !service) return [];

    const people = [
      {
        id: "main",
        personLabel: name.trim() || "Hoofdpersoon",
        serviceId: selectedService,
        serviceName: service.name,
        assignmentMode: mainAssignmentMode,
        assignedEmployee: mainAssignedEmployee,
      },
      ...groupMembers.map((member, index) => ({
        id: member.id,
        personLabel: member.name.trim() || `Persoon ${index + 2}`,
        serviceId: member.serviceId,
        serviceName: bookingServices.find((item) => item.id === member.serviceId)?.name || "Behandeling",
        assignmentMode: member.assignmentMode,
        assignedEmployee: member.assignedEmployee,
      })),
    ];

    const targetIndex = Math.max(availableSlots.indexOf(selectedTime), 0);
    const options: PlacementOption[] = [];

    const simultaneousPlacements: PlacementEntry[] = [];
    const usedEmployees = new Set<string>();
    let simultaneousValid = true;

    for (const person of people) {
      const employeeOptions = getEmployeesForService(person.serviceId);

      if (person.assignmentMode === "manual") {
        const isAllowedEmployee = employeeOptions.some((employee) => employee.name === person.assignedEmployee);
        if (!person.assignedEmployee || !isAllowedEmployee || usedEmployees.has(person.assignedEmployee)) {
          simultaneousValid = false;
          break;
        }

        simultaneousPlacements.push({
          id: person.id,
          personLabel: person.personLabel,
          employee: person.assignedEmployee,
          time: selectedTime,
          serviceName: person.serviceName,
          assignmentMode: person.assignmentMode,
        });
        usedEmployees.add(person.assignedEmployee);
        continue;
      }

      const employee = employeeOptions.find((item) => !usedEmployees.has(item.name));
      if (!employee) {
        simultaneousValid = false;
        break;
      }

      simultaneousPlacements.push({
        id: person.id,
        personLabel: person.personLabel,
        employee: employee.name,
        time: selectedTime,
        serviceName: person.serviceName,
        assignmentMode: person.assignmentMode,
      });
      usedEmployees.add(employee.name);
    }

    if (simultaneousValid && simultaneousPlacements.length === people.length) {
      options.push({
        label: "Optie 1 · Tegelijk",
        description: "Alle personen starten op hetzelfde tijdstip als de medewerkers beschikbaar zijn.",
        placements: simultaneousPlacements,
      });
    }

    const nextSlotPerEmployee = new Map<string, number>();
    const sequentialPlacements: PlacementEntry[] = [];
    let sequentialValid = true;

    for (const person of people) {
      const employeeOptions = getEmployeesForService(person.serviceId);

      if (person.assignmentMode === "manual") {
        const isAllowedEmployee = employeeOptions.some((employee) => employee.name === person.assignedEmployee);
        if (!person.assignedEmployee || !isAllowedEmployee) {
          sequentialValid = false;
          break;
        }

        const slotIndex = nextSlotPerEmployee.get(person.assignedEmployee) ?? targetIndex;
        const slot = availableSlots[slotIndex];
        if (!slot) {
          sequentialValid = false;
          break;
        }

        sequentialPlacements.push({
          id: person.id,
          personLabel: person.personLabel,
          employee: person.assignedEmployee,
          time: slot,
          serviceName: person.serviceName,
          assignmentMode: person.assignmentMode,
        });
        nextSlotPerEmployee.set(person.assignedEmployee, slotIndex + 1);
        continue;
      }

      const candidate = employeeOptions
        .map((employee) => ({ employee, slotIndex: nextSlotPerEmployee.get(employee.name) ?? targetIndex }))
        .sort((left, right) => left.slotIndex - right.slotIndex)[0];

      if (!candidate || !availableSlots[candidate.slotIndex]) {
        sequentialValid = false;
        break;
      }

      sequentialPlacements.push({
        id: person.id,
        personLabel: person.personLabel,
        employee: candidate.employee.name,
        time: availableSlots[candidate.slotIndex],
        serviceName: person.serviceName,
        assignmentMode: person.assignmentMode,
      });
      nextSlotPerEmployee.set(candidate.employee.name, candidate.slotIndex + 1);
    }

    if (sequentialValid && sequentialPlacements.length === people.length) {
      const hasMultipleTimes = new Set(sequentialPlacements.map((placement) => placement.time)).size > 1;
      options.push({
        label: hasMultipleTimes ? "Optie 2 · Na elkaar" : "Optie 2 · Beste match",
        description: hasMultipleTimes
          ? "Niet iedereen past tegelijk; dit is de slimste planning met minimale wachttijd."
          : "Beste beschikbare verdeling op hetzelfde tijdstip.",
        placements: sequentialPlacements,
      });
    }

    return options.filter((option, index, array) => index === array.findIndex((item) => JSON.stringify(item.placements) === JSON.stringify(option.placements)));
  };

  const handleProceedToDetails = () => {
    if (!selectedTime) return;

    if (!isGroupBooking) {
      setStep(3);
      return;
    }

    if (mainAssignmentMode === "manual" && !mainAssignedEmployee) {
      toast.error("Kies een medewerker voor de hoofdpersoon of gebruik automatische plaatsing.");
      return;
    }

    const missingEmployee = groupMembers.find((member) => member.assignmentMode === "manual" && !member.assignedEmployee);
    if (missingEmployee) {
      toast.error("Kies voor elke handmatige persoon een medewerker.");
      return;
    }

    const options = buildPlacementOptions();
    if (options.length === 0) {
      toast.error("Niet alle personen tegelijk beschikbaar. Kies een andere tijd of andere medewerker.");
      return;
    }

    setPlacementOptions(options);
    setSelectedPlacementIndex(0);
    setStep(3);
  };

  const handleConfirm = async () => {
    if (!paymentDecision?.required) {
      toast.success("Afspraak bevestigd! ✅");
      setPaymentResult({
        status: "success",
        message: isGroupBooking
          ? `Groepsboeking bevestigd! ${groupMembers.length + 1} personen ingepland.`
          : "Afspraak bevestigd! Geen betaling vereist.",
      });
      return;
    }

    setPaymentLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: {
          amount: paymentDecision.amount,
          payment_type: paymentDecision.type,
          method: selectedMethod,
          is_demo: isDemoMode,
        },
      });

      if (error) throw error;

      if (data?.demo) {
        if (data.payment?.status === "paid") {
          setPaymentResult({ status: "success", message: data.message });
          toast.success(data.message);
        } else {
          setPaymentResult({ status: "failed", message: data.message });
          toast.error(data.message);
        }
      } else if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (err: any) {
      const msg = err?.message || "Betaling mislukt";
      setPaymentResult({ status: "failed", message: msg });
      toast.error(msg);
    } finally {
      setPaymentLoading(false);
    }
  };

  const resetAll = () => {
    setStep(1);
    setPaymentResult(null);
    setName("");
    setPhone("");
    setSelectedService(null);
    setSelectedTime(null);
    setIsGroupBooking(false);
    setMainAssignmentMode("auto");
    setMainAssignedEmployee("");
    setGroupMembers([]);
    resetPlacementOptions();
  };

  const renderAssignmentCard = ({
    title,
    subtitle,
    serviceId,
    assignmentMode,
    assignedEmployee,
    onAssignmentModeChange,
    onAssignedEmployeeChange,
  }: {
    title: string;
    subtitle: string;
    serviceId: string;
    assignmentMode: AssignmentMode;
    assignedEmployee: string;
    onAssignmentModeChange: (mode: AssignmentMode) => void;
    onAssignedEmployeeChange: (employee: string) => void;
  }) => {
    const availableEmployees = getEmployeesForService(serviceId);

    return (
      <div className="p-3 rounded-xl bg-secondary/50 border border-border space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{title}</p>
            <p className="text-[11px] text-muted-foreground">{subtitle}</p>
          </div>
          <span className="text-[11px] text-muted-foreground">{assignmentMode === "manual" ? "Handmatig gekozen" : "Automatisch geplaatst"}</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => {
              onAssignmentModeChange("manual");
              resetPlacementOptions();
            }}
            className={cn(
              "flex-1 px-3 py-2 rounded-xl border text-xs font-medium transition-colors",
              assignmentMode === "manual" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
            )}
          >
            Medewerker kiezen
          </button>
          <button
            onClick={() => {
              onAssignmentModeChange("auto");
              onAssignedEmployeeChange("");
              resetPlacementOptions();
            }}
            className={cn(
              "flex-1 px-3 py-2 rounded-xl border text-xs font-medium transition-colors",
              assignmentMode === "auto" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
            )}
          >
            <Zap className="w-3 h-3 inline mr-1" />Automatische plaatsing
          </button>
        </div>

        {assignmentMode === "manual" ? (
          <select
            value={assignedEmployee}
            onChange={(event) => {
              resetPlacementOptions();
              onAssignedEmployeeChange(event.target.value);
            }}
            className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">Kies medewerker</option>
            {availableEmployees.map((employee) => (
              <option key={employee.name} value={employee.name}>
                {employee.name} ({employee.role})
              </option>
            ))}
          </select>
        ) : (
          <div className="px-3 py-2 rounded-xl bg-primary/5 border border-primary/10 text-[11px] text-muted-foreground">
            Beschikbare medewerkers: {availableEmployees.map((employee) => employee.name).join(", ")}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border p-5">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl gradient-bg flex items-center justify-center">
            <span className="text-sm font-bold text-primary-foreground">GS</span>
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">Glow Studio</h1>
            <p className="text-[11px] text-muted-foreground">Online Afspraak Maken</p>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-2xl mx-auto w-full p-6">
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                  step >= s ? "gradient-bg text-primary-foreground" : "bg-secondary text-muted-foreground"
                )}
              >
                {step > s ? <Check className="w-4 h-4" /> : s}
              </div>
              <span className={cn("text-xs font-medium hidden sm:block", step >= s ? "text-foreground" : "text-muted-foreground")}>
                {s === 1 ? "Behandeling" : s === 2 ? "Tijd" : "Gegevens"}
              </span>
              {s < 3 && <div className={cn("flex-1 h-px", step > s ? "bg-primary" : "bg-border")} />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-3 opacity-0 animate-fade-in-up" style={{ animationDelay: "100ms" }}>
            <h2 className="text-xl font-bold mb-2">Kies een behandeling</h2>

            <button
              onClick={() => {
                resetPlacementOptions();
                setIsGroupBooking(!isGroupBooking);
                setMainAssignmentMode("auto");
                setMainAssignedEmployee("");
                if (isGroupBooking) setGroupMembers([]);
              }}
              className={cn(
                "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left text-sm",
                isGroupBooking ? "border-primary bg-primary/10" : "border-border bg-secondary/30 hover:bg-secondary/60"
              )}
            >
              <Users className="w-5 h-5" />
              <div className="flex-1">
                <span className="font-medium">Groepsboeking</span>
                <p className="text-[11px] text-muted-foreground">Boek voor meerdere personen tegelijk</p>
              </div>
              <div className={`w-10 h-6 rounded-full transition-colors ${isGroupBooking ? "bg-primary" : "bg-secondary"}`}>
                <div className={`w-4 h-4 rounded-full bg-white transition-transform mt-1 ${isGroupBooking ? "translate-x-5" : "translate-x-1"}`} />
              </div>
            </button>

            <p className="text-xs text-muted-foreground mt-2 mb-1">{isGroupBooking ? "Hoofdpersoon — kies behandeling:" : ""}</p>

            {bookingServices.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  resetPlacementOptions();
                  setSelectedService(item.id);
                }}
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 text-left",
                  selectedService === item.id ? "border-primary bg-primary/10" : "border-border bg-secondary/30 hover:bg-secondary/60"
                )}
              >
                <div className="w-2 h-10 rounded-full" style={{ backgroundColor: item.color || "hsl(var(--primary))" }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{item.name}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {item.duration} min
                    </span>
                  </div>
                </div>
                <p className="text-sm font-bold tabular-nums">{formatEuro(item.price)}</p>
              </button>
            ))}

            {isGroupBooking && selectedService && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Extra personen</p>
                  <Button variant="outline" size="sm" onClick={addGroupMember}>
                    <Plus className="w-3.5 h-3.5 mr-1" />Persoon toevoegen
                  </Button>
                </div>

                {groupMembers.map((member, idx) => (
                  <div key={member.id} className="p-3 rounded-xl bg-secondary/50 border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Persoon {idx + 2}</span>
                      <button onClick={() => removeGroupMember(member.id)} className="p-1 rounded hover:bg-destructive/20">
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </button>
                    </div>
                    <input
                      placeholder="Naam"
                      value={member.name}
                      onChange={(e) => updateGroupMember(member.id, { name: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <select
                      value={member.serviceId}
                      onChange={(e) => updateGroupMember(member.id, { serviceId: e.target.value, assignedEmployee: "" })}
                      className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {bookingServices.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} — {formatEuro(item.price)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}

                {groupMembers.length > 0 && (
                  <div className="p-3 rounded-xl bg-primary/5 border border-primary/10 text-sm">
                    <span className="text-muted-foreground">Totaalprijs:</span> <span className="font-bold">{formatEuro(totalPrice)}</span>
                    <span className="text-muted-foreground ml-2">({groupMembers.length + 1} personen)</span>
                  </div>
                )}
              </div>
            )}

            <Button
              variant="gradient"
              className="w-full mt-4"
              disabled={!selectedService || (isGroupBooking && groupMembers.some((member) => !member.name || !member.serviceId))}
              onClick={() => setStep(2)}
            >
              Volgende <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="opacity-0 animate-fade-in-up" style={{ animationDelay: "100ms" }}>
            <button onClick={() => setStep(1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
              <ArrowLeft className="w-4 h-4" /> Terug
            </button>
            <h2 className="text-xl font-bold mb-2">Kies een tijdstip</h2>
            <p className="text-sm text-muted-foreground mb-6">
              <Calendar className="w-4 h-4 inline mr-1" />Dinsdag 22 maart 2026
            </p>

            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {availableSlots.map((slot) => (
                <button
                  key={slot}
                  onClick={() => {
                    resetPlacementOptions();
                    setSelectedTime(slot);
                  }}
                  className={cn(
                    "p-3 rounded-xl text-sm font-medium tabular-nums border transition-all duration-200",
                    selectedTime === slot ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary/60"
                  )}
                >
                  {slot}
                </button>
              ))}
            </div>

            {isGroupBooking && selectedService && selectedTime && (
              <div className="mt-6 space-y-3">
                <p className="text-sm font-semibold">Medewerker keuze of automatische plaatsing</p>
                {renderAssignmentCard({
                  title: "Hoofdpersoon",
                  subtitle: `${service?.name || "Behandeling"} · Startvoorkeur ${selectedTime}`,
                  serviceId: selectedService,
                  assignmentMode: mainAssignmentMode,
                  assignedEmployee: mainAssignedEmployee,
                  onAssignmentModeChange: setMainAssignmentMode,
                  onAssignedEmployeeChange: setMainAssignedEmployee,
                })}

                {groupMembers.map((member, idx) => {
                  const memberService = bookingServices.find((item) => item.id === member.serviceId);

                  return renderAssignmentCard({
                    title: member.name || `Persoon ${idx + 2}`,
                    subtitle: `${memberService?.name || "Behandeling"} · Startvoorkeur ${selectedTime}`,
                    serviceId: member.serviceId,
                    assignmentMode: member.assignmentMode,
                    assignedEmployee: member.assignedEmployee,
                    onAssignmentModeChange: (assignmentMode) => updateGroupMember(member.id, { assignmentMode }),
                    onAssignedEmployeeChange: (assignedEmployee) => updateGroupMember(member.id, { assignedEmployee }),
                  });
                })}
              </div>
            )}

            <Button variant="gradient" className="w-full mt-6" disabled={!selectedTime} onClick={handleProceedToDetails}>
              Volgende <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="opacity-0 animate-fade-in-up" style={{ animationDelay: "100ms" }}>
            <button onClick={() => { setStep(2); setPaymentResult(null); }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
              <ArrowLeft className="w-4 h-4" /> Terug
            </button>
            <h2 className="text-xl font-bold mb-6">Jouw gegevens</h2>

            <div className="glass-card p-4 mb-6">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Behandeling</span>
                <span className="font-medium">{service?.name}</span>
              </div>
              {isGroupBooking && groupMembers.map((member, index) => {
                const memberService = bookingServices.find((item) => item.id === member.serviceId);
                return (
                  <div key={member.id} className="flex items-center justify-between text-sm mt-1">
                    <span className="text-muted-foreground text-xs">{member.name || `Persoon ${index + 2}`}</span>
                    <span className="text-xs">{memberService?.name} — {formatEuro(memberService?.price || 0)}</span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-muted-foreground">Tijdstip</span>
                <span className="font-medium">{selectedTime} · Di 22 mrt</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-muted-foreground">Totaalprijs</span>
                <span className="font-bold">{formatEuro(totalPrice)}</span>
              </div>
              {isGroupBooking && (
                <div className="mt-2 pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="w-3 h-3" />Groepsboeking · {groupMembers.length + 1} personen
                  </span>
                </div>
              )}
            </div>

            {isGroupBooking && selectedPlacements.length > 0 && (
              <div className="space-y-3 mb-6">
                {placementOptions.length > 1 && (
                  <div className="grid gap-2">
                    {placementOptions.map((option, index) => (
                      <button
                        key={option.label}
                        onClick={() => setSelectedPlacementIndex(index)}
                        className={cn(
                          "w-full text-left p-3 rounded-xl border transition-all",
                          selectedPlacementIndex === index ? "border-primary bg-primary/10" : "border-border bg-secondary/30 hover:bg-secondary/50"
                        )}
                      >
                        <p className="text-sm font-medium">{option.label}</p>
                        <p className="text-[11px] text-muted-foreground mt-1">{option.description}</p>
                      </button>
                    ))}
                  </div>
                )}

                <div className="p-4 rounded-xl border border-border bg-secondary/30 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Check className="w-4 h-4 text-primary" />Plaatsing overzicht
                  </div>
                  {selectedPlacements.map((placement) => (
                    <div key={placement.id} className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <p className="font-medium">{placement.personLabel}</p>
                        <p className="text-[11px] text-muted-foreground">{placement.serviceName} · {placement.assignmentMode === "manual" ? "Handmatig gekozen" : "Automatisch geplaatst"}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{placement.employee}</p>
                        <p className="text-[11px] text-muted-foreground">{placement.time}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {placementOptions[selectedPlacementIndex]?.label.includes("Na elkaar") && (
                  <div className="p-3 rounded-xl bg-primary/5 border border-primary/10 text-sm flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium">Niet alle personen tegelijk beschikbaar</p>
                      <p className="text-xs text-muted-foreground">We tonen automatisch het beste alternatief met minimale wachttijd.</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {paymentDecision && (
              <div className={cn("p-4 rounded-xl mb-6 text-sm", paymentDecision.required ? "bg-primary/10 border border-primary/20" : "bg-success/10 border border-success/20")}>
                <div className="flex items-center gap-2 mb-1">
                  <CreditCard className="w-4 h-4" />
                  <span className="font-medium">
                    {paymentDecision.required
                      ? paymentDecision.type === "full"
                        ? "Volledige betaling vereist"
                        : "Aanbetaling vereist"
                      : "Geen betaling nodig"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{paymentDecision.reason}</p>
                {paymentDecision.required && <p className="font-semibold mt-1">Te betalen: {formatEuro(paymentDecision.amount)}</p>}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Naam</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Je volledige naam"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full h-11 pl-10 pr-4 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Telefoonnummer</label>
                <input
                  type="tel"
                  placeholder="+31 6 1234 5678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            {paymentDecision?.required && (
              <div className="mt-6">
                <label className="text-sm font-medium mb-2 block">Betaalmethode</label>
                <div className="grid grid-cols-2 gap-2">
                  {paymentMethods.map((method) => (
                    <button
                      key={method.id}
                      onClick={() => setSelectedMethod(method.id)}
                      className={cn(
                        "p-3 rounded-xl border text-sm font-medium transition-all duration-200 flex items-center gap-2",
                        selectedMethod === method.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary/60"
                      )}
                    >
                      <span>{method.icon}</span> {method.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {paymentResult && (
              <div className={cn("mt-6 p-4 rounded-xl text-sm text-center", paymentResult.status === "success" ? "bg-success/10 border border-success/20 text-success" : "bg-destructive/10 border border-destructive/20 text-destructive")}>
                <p className="font-semibold">{paymentResult.message}</p>
                {paymentResult.status === "success" && <p className="text-xs mt-1 text-muted-foreground">Je ontvangt een bevestiging per e-mail.</p>}
              </div>
            )}

            {!paymentResult && (
              <Button variant="gradient" className="w-full mt-6" disabled={!name || !phone || paymentLoading} onClick={handleConfirm}>
                {paymentLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Betaling verwerken...
                  </>
                ) : paymentDecision?.required ? (
                  <>
                    <CreditCard className="w-4 h-4" /> Betaal {formatEuro(paymentDecision.amount)}
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" /> Afspraak Bevestigen
                  </>
                )}
              </Button>
            )}

            {paymentResult && (
              <Button variant="outline" className="w-full mt-3" onClick={resetAll}>
                Nieuwe afspraak maken
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
