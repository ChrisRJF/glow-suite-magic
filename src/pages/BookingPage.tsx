import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { services as fallbackServices, formatEuro } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Check, Clock, ArrowLeft, ArrowRight, Calendar, User, CreditCard, Loader2, Plus, Trash2, Users, Zap, AlertCircle, Mail, Shield, Sparkles, RotateCcw, Share2, CalendarPlus, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePaymentRules } from "@/hooks/usePaymentRules";
import { useServices, useSettings } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { queueLeadIntent } from "@/hooks/useLeadAutomation";
import { getBranding, fetchBranding, applyBrandingToDocument, type WhiteLabelBranding } from "@/lib/whitelabel";
import { callPublicBooking, nextBookingDate, type PublicBookingData } from "@/lib/publicBooking";
import { PaymentMethodLogo } from "@/components/PaymentMethodLogo";

// Lightweight conversion tracking — sends events to host page via postMessage
function trackEvent(event: string, data?: Record<string, any>) {
  try {
    const payload = { type: "glowsuite:track", event, data, ts: Date.now() };
    if (typeof window !== "undefined") {
      window.parent?.postMessage(payload, "*");
      // Also log for debugging
      console.debug("[GlowSuite Track]", event, data);
    }
  } catch {}
}

const SLOT_LABELS: Record<string, { label: string; tone: "primary" | "success" | "muted" }> = {
  "09:00": { label: "Eerst beschikbaar", tone: "primary" },
  "10:00": { label: "Vandaag nog plek", tone: "success" },
  "14:30": { label: "Populaire tijd", tone: "muted" },
};

const STORAGE_KEY = "glowsuite:booking-progress";

const availableSlots = ["09:00", "10:00", "11:30", "13:00", "14:30", "16:00", "17:00"];
const paymentMethods = [
  { id: "ideal", label: "iDEAL | Wero" },
  { id: "creditcard", label: "Creditcard" },
  { id: "bancontact", label: "Bancontact" },
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
  const { salonSlug } = useParams();
  const isPublicBooking = Boolean(salonSlug);
  const { data: liveServices } = useServices();
  const { data: liveSettings } = useSettings();
  const settingsRow = liveSettings[0] as any | undefined;
  const [publicData, setPublicData] = useState<PublicBookingData | null>(null);
  const [publicLoading, setPublicLoading] = useState(isPublicBooking);
  const [publicError, setPublicError] = useState<string | null>(null);
  const isDemoMode = Boolean(publicData?.salon.demo_mode ?? settingsRow?.demo_mode);
  const [step, setStep] = useState(1);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => nextBookingDate());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [emailLookupLoading, setEmailLookupLoading] = useState(false);
  const [recognizedCustomer, setRecognizedCustomer] = useState<{ name?: string; phone?: string } | null>(null);
  const [recentAppointments, setRecentAppointments] = useState<Array<{ id: string; service_id: string | null; appointment_date: string; service_name?: string }>>([]);
  const [selectedMethod, setSelectedMethod] = useState("ideal");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentResult, setPaymentResult] = useState<{ status: string; message: string } | null>(null);
  const [confirmation, setConfirmation] = useState<any>(null);
  const [isGroupBooking, setIsGroupBooking] = useState(false);
  const [mainAssignmentMode, setMainAssignmentMode] = useState<AssignmentMode>("auto");
  const [mainAssignedEmployee, setMainAssignedEmployee] = useState("");
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [placementOptions, setPlacementOptions] = useState<PlacementOption[]>([]);
  const [selectedPlacementIndex, setSelectedPlacementIndex] = useState(0);

  useEffect(() => {
    if (!salonSlug) return;
    let cancelled = false;
    setPublicLoading(true);
    setPublicError(null);
    callPublicBooking<PublicBookingData>({ action: "get_salon", slug: salonSlug })
      .then((data) => {
        if (cancelled) return;
        setPublicData(data);
        setBranding((current) => ({
          ...current,
          salon_name: data.salon.name,
          logo_url: data.salon.logo_url || current.logo_url,
          primary_color: data.salon.primary_color || current.primary_color,
          secondary_color: data.salon.secondary_color || current.secondary_color,
        }));
      })
      .catch((error) => {
        if (!cancelled) setPublicError(error.message || "Deze boekingspagina bestaat niet.");
      })
      .finally(() => {
        if (!cancelled) setPublicLoading(false);
      });
    return () => { cancelled = true; };
  }, [salonSlug]);

  useEffect(() => {
    if (!salonSlug) return;
    const params = new URLSearchParams(window.location.search);
    const bookingToken = params.get("booking");
    if (params.get("status") !== "payment-return" || !bookingToken) return;
    callPublicBooking<any>({ action: "get_booking", slug: salonSlug, booking_token: bookingToken })
      .then((result) => {
        setConfirmation(result.confirmation);
        setPaymentResult({
          status: result.confirmation?.payment_status === "paid" ? "success" : "failed",
          message: result.confirmation?.payment_status === "paid"
            ? "Betaling ontvangen. Je afspraak is bevestigd."
            : "Je afspraak is opgeslagen. De betaling is nog niet afgerond.",
        });
        setStep(3);
      })
      .catch((error) => toast.error(error.message || "Betaalstatus kon niet worden opgehaald."));
  }, [salonSlug]);

  // White-label embed mode: detect ?embed=1 in URL and load salon branding
  const isEmbed = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1";
  const [branding, setBranding] = useState<WhiteLabelBranding>(() => getBranding());
  useEffect(() => {
    if (isEmbed) applyBrandingToDocument(branding);
    // Sync from DB so embed reflects salon's saved branding across devices
    if (isPublicBooking) return;
    fetchBranding().then((remote) => {
      setBranding(remote);
      if (isEmbed) applyBrandingToDocument(remote);
    });
    const handler = () => setBranding(getBranding());
    window.addEventListener("whitelabel:updated", handler);
    return () => window.removeEventListener("whitelabel:updated", handler);
  }, [isEmbed, branding, isPublicBooking]);

  const bookingServices = useMemo<BookingServiceOption[]>(() => {
    if (publicData) return publicData.services;
    if (!isPublicBooking && liveServices.length > 0) {
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

    if (isPublicBooking) return [];
    return fallbackServices.map((service) => ({
      id: service.id,
      name: service.name,
      duration: service.duration,
      price: service.price,
      color: service.color,
      description: null,
    }));
  }, [isPublicBooking, liveServices, publicData]);

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
    if (step >= 3 && (name.trim() || phone.trim() || email.trim())) {
      const svc = bookingServices.find((s) => s.id === selectedService);
      queueLeadIntent({
        name: name.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        service: svc?.name,
        intent_time: selectedTime || undefined,
      });
    }
  }, [step, name, phone, email, selectedService, selectedTime, bookingServices]);

  useEffect(() => {
    const handler = () => {
      if (step >= 2 && (name.trim() || phone.trim() || email.trim()) && !paymentResult) {
        const svc = bookingServices.find((s) => s.id === selectedService);
        queueLeadIntent({
          name: name.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          service: svc?.name,
          intent_time: selectedTime || undefined,
        });
        trackEvent("booking_abandoned", { step, hasService: !!selectedService, hasTime: !!selectedTime });
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [step, name, phone, email, selectedService, selectedTime, paymentResult, bookingServices]);

  // Persist progress in session so user doesn't lose it on accidental close
  useEffect(() => {
    try {
      const snap = { step, selectedService, selectedTime, name, email, phone, isGroupBooking };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch {}
  }, [step, selectedService, selectedTime, name, email, phone, isGroupBooking]);

  // Restore progress + emit widget_opened on mount
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const snap = JSON.parse(raw);
        if (snap.selectedService) setSelectedService(snap.selectedService);
        if (snap.selectedTime) setSelectedTime(snap.selectedTime);
        if (snap.name) setName(snap.name);
        if (snap.email) setEmail(snap.email);
        if (snap.phone) setPhone(snap.phone);
        if (snap.isGroupBooking) setIsGroupBooking(snap.isGroupBooking);
      }
    } catch {}
    trackEvent("widget_opened");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track step changes for funnel insights
  useEffect(() => {
    if (step === 1) trackEvent("step_service");
    if (step === 2) trackEvent("step_time", { service: selectedService });
    if (step === 3) trackEvent("step_details", { service: selectedService, time: selectedTime });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Email-first smart lookup
  const lookupCustomerByEmail = useCallback(async (rawEmail: string) => {
    const value = rawEmail.trim().toLowerCase();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setRecognizedCustomer(null);
      setRecentAppointments([]);
      return;
    }
    setEmailLookupLoading(true);
    try {
      if (isPublicBooking && salonSlug) {
        const result = await callPublicBooking<{ customer: { name?: string; phone?: string } | null; recentAppointments: Array<{ id: string; service_id: string | null; appointment_date: string }> }>({
          action: "lookup_customer",
          slug: salonSlug,
          email: value,
        });
        const customer = result.customer;
        if (!customer) {
          setRecognizedCustomer(null);
          setRecentAppointments([]);
          return;
        }
        setRecognizedCustomer({ name: customer.name, phone: customer.phone || "" });
        setName((current) => current || customer.name || "");
        setPhone((current) => current || customer.phone || "");
        setRecentAppointments((result.recentAppointments || []).map((appt) => ({
          ...appt,
          service_name: bookingServices.find((s) => s.id === appt.service_id)?.name,
        })));
        trackEvent("email_recognized", { public: true, hasRecent: (result.recentAppointments || []).length > 0 });
        return;
      }
      const { data: customers } = await supabase
        .from("customers")
        .select("id, name, phone, email")
        .ilike("email", value)
        .limit(1);
      const customer = customers?.[0];
      if (!customer) {
        setRecognizedCustomer(null);
        setRecentAppointments([]);
        return;
      }
      setRecognizedCustomer({ name: customer.name, phone: customer.phone || "" });
      setName((current) => current || customer.name || "");
      setPhone((current) => current || customer.phone || "");
      const { data: appts } = await supabase
        .from("appointments")
        .select("id, service_id, appointment_date")
        .eq("customer_id", customer.id)
        .order("appointment_date", { ascending: false })
        .limit(3);
      const enriched = (appts || []).map((appt) => ({
        ...appt,
        service_name: bookingServices.find((s) => s.id === appt.service_id)?.name,
      }));
      setRecentAppointments(enriched);
      trackEvent("email_recognized", { hasRecent: enriched.length > 0 });
    } catch (err) {
      console.warn("Customer lookup failed", err);
    } finally {
      setEmailLookupLoading(false);
    }
  }, [bookingServices, isPublicBooking, salonSlug]);

  useEffect(() => {
    const t = setTimeout(() => { if (email) lookupCustomerByEmail(email); }, 600);
    return () => clearTimeout(t);
  }, [email, lookupCustomerByEmail]);

  // Quick rebook: select previous service and skip to time selection
  const handleQuickRebook = (serviceId: string | null) => {
    if (!serviceId) return;
    setSelectedService(serviceId);
    setStep(2);
    trackEvent("quick_rebook", { service: serviceId });
  };

  const service = bookingServices.find((item) => item.id === selectedService);

  const rules = usePaymentRules({
    deposit_new_client: publicData?.salon.booking_rules.deposit_new_client ?? settingsRow?.deposit_new_client ?? true,
    deposit_percentage: publicData?.salon.booking_rules.deposit_percentage ?? settingsRow?.deposit_percentage ?? 50,
    full_prepay_threshold: publicData?.salon.booking_rules.full_prepay_threshold ?? (Number(settingsRow?.full_prepay_threshold) || 150),
    skip_prepay_vip: publicData?.salon.booking_rules.skip_prepay_vip ?? settingsRow?.skip_prepay_vip ?? false,
    deposit_noshow_risk: publicData?.salon.booking_rules.deposit_noshow_risk ?? settingsRow?.deposit_noshow_risk ?? true,
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
    trackEvent("booking_attempt", { service: selectedService, time: selectedTime, total: totalPrice });
    if (!service || !selectedService || !selectedTime) {
      toast.error("Kies eerst een behandeling en tijdstip.");
      return;
    }

    if (isPublicBooking && salonSlug) {
      setPaymentLoading(true);
      try {
        const groupPayload = isGroupBooking
          ? groupMembers.map((member) => {
              const placement = selectedPlacements.find((item) => item.id === member.id);
              return {
                name: member.name,
                service_id: member.serviceId,
                time: placement?.time || selectedTime,
                employee: placement?.employee || member.assignedEmployee || null,
              };
            })
          : [];

        const result = await callPublicBooking<any>({
          action: "create_booking",
          slug: salonSlug,
          customer: { name, email, phone, privacy_consent: true, marketing_consent: false },
          date: selectedDate,
          time: selectedPlacements[0]?.time || selectedTime,
          service_id: selectedService,
          employee: selectedPlacements[0]?.employee || mainAssignedEmployee || null,
          group_members: groupPayload,
          payment: { required: Boolean(paymentDecision?.required), amount: paymentDecision?.amount || 0, type: paymentDecision?.type || "deposit", method: selectedMethod },
          notes: "",
        });

        setConfirmation(result.confirmation);
        if (result.checkoutUrl) {
          trackEvent("payment_redirect", { appointment_id: result.appointment?.id });
          window.location.href = result.checkoutUrl;
          return;
        }

        const message = result.paymentInitError || (paymentDecision?.required ? "Afspraak opgeslagen. Betaling staat in afwachting." : "Afspraak bevestigd! Geen betaling vereist.");
        setPaymentResult({ status: result.paymentInitError ? "failed" : "success", message });
        toast[result.paymentInitError ? "error" : "success"](message);
        try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
        trackEvent("booking_completed", { paid: !paymentDecision?.required, public: true });
      } catch (err: any) {
        const msg = err?.message || "Boeking kon niet worden opgeslagen.";
        if (err?.code === "slot_unavailable") {
          setPaymentResult(null);
          setSelectedTime(null);
          setStep(2);
        }
        setPaymentResult({ status: "failed", message: msg });
        toast.error(msg);
        trackEvent("booking_failed", { error: msg });
      } finally {
        setPaymentLoading(false);
      }
      return;
    }

    if (!paymentDecision?.required) {
      toast.success("Afspraak bevestigd! ✅");
      setPaymentResult({
        status: "success",
        message: isGroupBooking
          ? `Groepsboeking bevestigd! ${groupMembers.length + 1} personen ingepland.`
          : "Afspraak bevestigd! Geen betaling vereist.",
      });
      try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
      trackEvent("booking_completed", { paid: false });
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
          try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
          trackEvent("booking_completed", { paid: true, demo: true });
        } else {
          setPaymentResult({ status: "failed", message: data.message });
          toast.error(data.message);
          trackEvent("payment_failed", { demo: true });
        }
      } else if (data?.checkoutUrl) {
        trackEvent("payment_redirect");
        window.location.href = data.checkoutUrl;
      }
    } catch (err: any) {
      const msg = err?.message || "Betaling mislukt";
      setPaymentResult({ status: "failed", message: msg });
      toast.error(msg);
      trackEvent("payment_failed", { error: msg });
    } finally {
      setPaymentLoading(false);
    }
  };

  const resetAll = () => {
    setStep(1);
    setPaymentResult(null);
    setName("");
    setEmail("");
    setPhone("");
    setSelectedService(null);
    setSelectedTime(null);
    setIsGroupBooking(false);
    setMainAssignmentMode("auto");
    setMainAssignedEmployee("");
    setGroupMembers([]);
    setRecognizedCustomer(null);
    setRecentAppointments([]);
    resetPlacementOptions();
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  };

  // Add-to-calendar (.ics) generator for confirmation
  const downloadIcs = () => {
    if (!service || !selectedTime) return;
    const [h, m] = selectedTime.split(":").map(Number);
    const start = new Date(); start.setHours(h, m, 0, 0);
    const end = new Date(start.getTime() + (service.duration || 30) * 60000);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
    const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:${Date.now()}@glowsuite\nDTSTAMP:${fmt(new Date())}\nDTSTART:${fmt(start)}\nDTEND:${fmt(end)}\nSUMMARY:${service.name} — ${branding.salon_name}\nDESCRIPTION:Afspraak bij ${branding.salon_name}\nEND:VEVENT\nEND:VCALENDAR`;
    const blob = new Blob([ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "afspraak.ics"; a.click();
    URL.revokeObjectURL(url);
    trackEvent("calendar_added");
  };

  const shareAppointment = async () => {
    const text = `Mijn afspraak bij ${branding.salon_name}: ${service?.name} om ${selectedTime}`;
    try {
      if (navigator.share) await navigator.share({ title: branding.salon_name, text });
      else { await navigator.clipboard.writeText(text); toast.success("Gekopieerd"); }
      trackEvent("appointment_shared");
    } catch {}
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

  if (publicLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4">
          <div className="h-10 w-40 rounded-xl bg-secondary animate-pulse" />
          <div className="h-24 rounded-2xl bg-secondary animate-pulse" />
          <div className="h-24 rounded-2xl bg-secondary animate-pulse" />
          <p className="text-sm text-muted-foreground">Boekingspagina laden...</p>
        </div>
      </div>
    );
  }

  if (publicError || (isPublicBooking && !publicData)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-bold">Deze boekingspagina bestaat niet.</h1>
          <p className="text-sm text-muted-foreground">Controleer de link of neem contact op met de salon.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {!isEmbed && (
        <header className="border-b border-border p-5">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl gradient-bg flex items-center justify-center">
              <span className="text-sm font-bold text-primary-foreground">GS</span>
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight">{publicData?.salon.name || branding.salon_name || "Glow Studio"}</h1>
              <p className="text-[11px] text-muted-foreground">Boek je afspraak · Direct bevestigd</p>
            </div>
          </div>
        </header>
      )}
      {isEmbed && branding.show_logo && (
        <header className="p-4 flex items-center gap-3 max-w-2xl mx-auto w-full">
          {branding.logo_url ? (
            <img src={branding.logo_url} alt={branding.salon_name} className="w-10 h-10 rounded-xl object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: branding.primary_color }}>
              <span className="text-sm font-bold text-white">{branding.salon_name.charAt(0)}</span>
            </div>
          )}
          <div>
            <h1 className="text-base font-bold tracking-tight">{branding.salon_name}</h1>
            <p className="text-[11px] text-muted-foreground">Boek je afspraak · Direct bevestigd</p>
          </div>
        </header>
      )}

      <div className="flex-1 max-w-2xl mx-auto w-full p-4 sm:p-6 pb-28 sm:pb-6">
        {/* Conversion progress: Afspraak → Gegevens → Betalen */}
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Stap {paymentResult ? 3 : step <= 2 ? 1 : 2} van 3
          </span>
          <span className="text-[11px] text-muted-foreground hidden sm:block">
            {paymentResult ? "Bevestigd" : step <= 2 ? "Afspraak" : "Gegevens en betalen"}
          </span>
        </div>
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3].map((s) => {
            const currentStep = paymentResult ? 3 : step <= 2 ? 1 : 2;
            return (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                    currentStep >= s ? "gradient-bg text-primary-foreground" : "bg-secondary text-muted-foreground"
                  )}
                >
                  {currentStep > s ? <Check className="w-4 h-4" /> : s}
                </div>
                <span className={cn("text-xs font-medium hidden sm:block", currentStep >= s ? "text-foreground" : "text-muted-foreground")}>
                  {s === 1 ? "Afspraak" : s === 2 ? "Gegevens" : "Betalen"}
                </span>
                {s < 3 && <div className={cn("flex-1 h-px", currentStep > s ? "bg-primary" : "bg-border")} />}
              </div>
            );
          })}
        </div>

        {step === 1 && (
          <div className="space-y-3 opacity-0 animate-fade-in-up" style={{ animationDelay: "100ms" }}>
            <div className="mb-2">
              <h2 className="text-xl font-bold">Kies je behandeling</h2>
              <p className="text-xs text-muted-foreground mt-1">Binnen 1 minuut geboekt · Geen account nodig</p>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              <span className="trust-chip">
                <Check className="w-3 h-3 text-primary" /> Direct bevestigd
              </span>
              <span className="trust-chip">
                <Shield className="w-3 h-3 text-primary" /> Veilig betalen
              </span>
              <span className="trust-chip">
                <Sparkles className="w-3 h-3 text-primary" /> Geen account nodig
              </span>
              <span className="trust-chip">
                Gratis annuleren
              </span>
            </div>

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
                  "w-full flex items-center gap-4 p-4 sm:p-5 rounded-xl border transition-all duration-200 text-left shadow-[var(--shadow-xs)] active:scale-[0.99]",
                  selectedService === item.id ? "border-primary bg-primary/10 shadow-[var(--shadow-sm)]" : "border-border bg-card hover:bg-secondary/50"
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
                  <p className="text-base font-bold tabular-nums">{formatEuro(item.price)}</p>
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
              <Calendar className="w-4 h-4 inline mr-1" />{new Date(`${selectedDate}T00:00:00`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>

            {isPublicBooking && (
              <div className="grid grid-cols-3 gap-2 mb-4">
                {[0, 1, 2].map((offset) => {
                  const option = new Date();
                  option.setDate(option.getDate() + offset + 1);
                  const value = option.toISOString().slice(0, 10);
                  return (
                    <button
                      key={value}
                      onClick={() => { setSelectedDate(value); setSelectedTime(null); resetPlacementOptions(); }}
                      className={cn(
                        "px-2 py-2 rounded-xl border text-xs font-medium transition-colors",
                        selectedDate === value ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary/60"
                      )}
                    >
                      {option.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric" })}
                    </button>
                  );
                })}
              </div>
            )}

             <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {availableSlots.map((slot) => {
                const meta = SLOT_LABELS[slot];
                const isSelected = selectedTime === slot;
                return (
                  <button
                    key={slot}
                    onClick={() => {
                      resetPlacementOptions();
                      setSelectedTime(slot);
                      trackEvent("slot_selected", { slot });
                    }}
                    className={cn(
                       "relative min-h-14 p-3 rounded-xl text-sm font-medium tabular-nums border transition-all duration-200 flex flex-col items-center justify-center gap-1 active:scale-[0.98]",
                       isSelected ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-secondary/60"
                    )}
                  >
                    <span>{slot}</span>
                    {meta && (
                      <span className={cn(
                        "text-[9px] font-semibold leading-tight px-1.5 py-0.5 rounded-full",
                        meta.tone === "primary" && "bg-primary/15 text-primary",
                        meta.tone === "success" && "bg-success/15 text-success",
                        meta.tone === "muted" && "bg-secondary text-muted-foreground",
                      )}>{meta.label}</span>
                    )}
                  </button>
                );
              })}
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
                <span className="font-medium">{selectedTime} · {new Date(`${selectedDate}T00:00:00`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })}</span>
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
                <label className="text-sm font-medium mb-1.5 block">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="email"
                    placeholder="jouw@email.nl"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (e.target.value) trackEvent("email_filled"); }}
                    className="w-full h-11 pl-10 pr-10 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  {emailLookupLoading && <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />}
                </div>
                {recognizedCustomer && (
                  <p className="text-[11px] text-primary mt-1.5 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Welkom terug{recognizedCustomer.name ? `, ${recognizedCustomer.name.split(" ")[0]}` : ""}! Je gegevens zijn ingevuld.
                  </p>
                )}
              </div>

              {recentAppointments.length > 0 && (
                <div className="p-3 rounded-xl bg-primary/5 border border-primary/15 space-y-2">
                  <p className="text-xs font-semibold flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Boek opnieuw</p>
                  {recentAppointments.slice(0, 2).map((appt) => (
                    <button
                      key={appt.id}
                      onClick={() => handleQuickRebook(appt.service_id)}
                      className="w-full flex items-center justify-between text-left p-2 rounded-lg bg-background border border-border hover:border-primary transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium">{appt.service_name || "Behandeling"}</p>
                        <p className="text-[10px] text-muted-foreground">Vorige: {new Date(appt.appointment_date).toLocaleDateString("nl-NL")}</p>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-primary" />
                    </button>
                  ))}
                </div>
              )}

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
                        "min-h-14 p-3 rounded-xl border text-sm font-medium transition-all duration-200 flex items-center gap-3",
                        selectedMethod === method.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary/60"
                      )}
                    >
                      {method.icon ? <span>{method.icon}</span> : <PaymentMethodLogo method={method.id} className="h-6 max-w-20" />}
                      <span className="truncate">{method.label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Veilig afrekenen via GlowPay · SSL versleuteld
                </p>
              </div>
            )}

            {paymentResult && paymentResult.status === "success" && (
              <div className="mt-6 p-5 rounded-2xl bg-success/10 border border-success/20 text-center">
                <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-3">
                  <Check className="w-6 h-6 text-success" />
                </div>
                <p className="font-semibold text-success text-base">Afspraak bevestigd!</p>
                <p className="text-xs text-muted-foreground mt-1">Je ontvangt een bevestiging per e-mail.</p>

                <div className="mt-4 grid gap-1.5 text-left text-sm bg-background/60 rounded-xl p-3">
                  <div className="flex justify-between"><span className="text-muted-foreground">Salon</span><span className="font-medium">{confirmation?.salon_name || publicData?.salon.name || branding.salon_name}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Behandeling</span><span className="font-medium">{confirmation?.service_name || service?.name}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Datum</span><span className="font-medium">{confirmation?.date ? new Date(`${confirmation.date}T00:00:00`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }) : "Di 22 mrt"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Tijd</span><span className="font-medium">{confirmation?.time || selectedTime}</span></div>
                  {selectedPlacements[0]?.employee && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Medewerker</span><span className="font-medium">{selectedPlacements[0].employee}</span></div>
                  )}
                  {confirmation?.reference && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Referentie</span><span className="font-medium tabular-nums">{confirmation.reference}</span></div>
                  )}
                  {paymentDecision?.required && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Betaling</span><span className="font-medium text-success">{confirmation?.payment_status === "paid" ? "Voldaan" : "In afwachting"} · {formatEuro(paymentDecision.amount)}</span></div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={downloadIcs}><CalendarPlus className="w-3.5 h-3.5 mr-1" />Toevoegen aan agenda</Button>
                  <Button variant="outline" size="sm" onClick={shareAppointment}><Share2 className="w-3.5 h-3.5 mr-1" />Delen</Button>
                </div>
              </div>
            )}

            {paymentResult && paymentResult.status !== "success" && (
              <div className="mt-6 p-4 rounded-xl text-sm text-center bg-destructive/10 border border-destructive/20 text-destructive">
                <p className="font-semibold">{paymentResult.message}</p>
                <p className="text-xs mt-1 text-muted-foreground">Probeer het opnieuw of kies een andere betaalmethode.</p>
              </div>
            )}

            {!paymentResult && (
              <div className="mt-6 sm:static fixed bottom-0 left-0 right-0 sm:bg-transparent bg-background/95 sm:border-0 border-t border-border sm:p-0 p-4 sm:shadow-none shadow-lg z-40">
                <Button variant="gradient" className="w-full" disabled={!name || !phone || !email || paymentLoading} onClick={handleConfirm}>
                  {paymentLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Betaling verwerken...</>
                  ) : paymentDecision?.required ? (
                    <><CreditCard className="w-4 h-4" /> Betaal {formatEuro(paymentDecision.amount)} & bevestig</>
                  ) : (
                    <><Check className="w-4 h-4" /> Bevestig afspraak</>
                  )}
                </Button>
                {paymentDecision?.required && (
                  <p className="text-[10px] text-center text-muted-foreground mt-2 hidden sm:block">
                    Aanbetaling vereist om je plek te bevestigen
                  </p>
                )}
              </div>
            )}

            {paymentResult && (
              <Button variant="outline" className="w-full mt-3" onClick={resetAll}>
                Nieuwe afspraak maken
              </Button>
            )}
          </div>
        )}
      </div>
      {isEmbed && !branding.hide_glowsuite_branding && (
        <footer className="text-center py-3 text-[10px] text-muted-foreground/60">
          Powered by GlowSuite
        </footer>
      )}
    </div>
  );
}
