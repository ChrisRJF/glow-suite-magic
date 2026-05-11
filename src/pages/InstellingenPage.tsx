import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useSettings, useCustomers, useAppointments, useServices } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { useCrud } from "@/hooks/useCrud";
import {
  User, Building, Bell, Save, CreditCard, Shield, RotateCcw, Loader2,
  Clock, Calendar, Globe, Users, Download, Link2, Plug, CheckCircle2, XCircle,
  UserCog, AlertTriangle, Plus, Trash2, Facebook, Instagram, ExternalLink, Sparkles, PlayCircle, FileUp,
} from "lucide-react";
import { ImportWizard } from "@/components/ImportWizard";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { exportCSV, exportExcel } from "@/lib/exportUtils";
import { formatEuro } from "@/lib/data";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { getMessageSettings, saveMessageSettings, type MessageSettings } from "@/lib/messaging";
import { WhiteLabelEmbedCard } from "@/components/WhiteLabelEmbedCard";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { useUserRole } from "@/hooks/useUserRole";
import { hasPermission } from "@/lib/permissions";

type OpeningHours = Record<string, { open: string; close: string; enabled: boolean }>;

const defaultHours: OpeningHours = {
  ma: { open: "09:00", close: "18:00", enabled: true },
  di: { open: "09:00", close: "18:00", enabled: true },
  wo: { open: "09:00", close: "18:00", enabled: true },
  do: { open: "09:00", close: "18:00", enabled: true },
  vr: { open: "09:00", close: "18:00", enabled: true },
  za: { open: "09:00", close: "17:00", enabled: true },
  zo: { open: "09:00", close: "17:00", enabled: false },
};

const dayOrder = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

const dayLabels: Record<string, string> = {
  ma: "Maandag", di: "Dinsdag", wo: "Woensdag", do: "Donderdag",
  vr: "Vrijdag", za: "Zaterdag", zo: "Zondag",
};

export default function InstellingenPage() {
  const { user } = useAuth();
  const { roles, isOwner } = useUserRole();
  const { data: settings, refetch } = useSettings();
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const { data: services } = useServices();
  const { insert, update } = useCrud("settings");
  const [salonName, setSalonName] = useState("Mijn Salon");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [googleReviewUrl, setGoogleReviewUrl] = useState("");
  const [notifications, setNotifications] = useState({ email: true, whatsapp: false, push: false });
  const [demoMode, setDemoMode] = useState(false);
  const [mollieMode, setMollieMode] = useState("test");
  const [paymentProvider, setPaymentProvider] = useState<"mollie" | "viva">("mollie");
  const [paymentFallback, setPaymentFallback] = useState(false);
  const [vivaStatus, setVivaStatus] = useState<{ configured: boolean; environment: "demo" | "live"; credentials_present: boolean; source_code_present: boolean } | null>(null);
  const [vivaChecklist, setVivaChecklist] = useState<Record<string, boolean>>({});
  const [vivaTestAmount, setVivaTestAmount] = useState("1.00");
  const [vivaTestEmail, setVivaTestEmail] = useState("test@example.com");
  const [vivaTestName, setVivaTestName] = useState("Test Klant");
  const [vivaTestLoading, setVivaTestLoading] = useState(false);
  const [vivaTestResult, setVivaTestResult] = useState<{ checkout_url: string; payment_id?: string; order_code?: string } | null>(null);
  const [vivaActivation, setVivaActivation] = useState<string>("not_started");
  const [vivaDiag, setVivaDiag] = useState<{ last_received: string | null; last_processed: string | null; failed_count: number; total_hits: number; last_post: string | null; malformed_count: number; latest_headers: Record<string, unknown> | null } | null>(null);
  const vivaWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/viva-webhook`;
  const [depositNewClient, setDepositNewClient] = useState(true);
  const [depositPct, setDepositPct] = useState(50);
  const [fullPrepayThreshold, setFullPrepayThreshold] = useState(150);
  const [skipVip, setSkipVip] = useState(true);
  const [depositNoshow, setDepositNoshow] = useState(true);
  const [autoRevenuePaymentMode, setAutoRevenuePaymentMode] = useState<"none" | "deposit" | "full">("deposit");
  const [resetLoading, setResetLoading] = useState(false);
  const [openingHours, setOpeningHours] = useState<OpeningHours>(defaultHours);
  const [bufferMinutes, setBufferMinutes] = useState(15);
  const [maxBookings, setMaxBookings] = useState(1);
  const [groupBookings, setGroupBookings] = useState(false);
  const [autoBlockNoshow, setAutoBlockNoshow] = useState(3);
  const [googleCalendar, setGoogleCalendar] = useState(false);
  const [instagramBooking, setInstagramBooking] = useState(false);
  const [activeTab, setActiveTab] = useState("algemeen");
  const [saveLoading, setSaveLoading] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // User management
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState("medewerker");
  const [addUserLoading, setAddUserLoading] = useState(false);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  // Integration states
  const [facebookEnabled, setFacebookEnabled] = useState(false);
  const [googleReserve, setGoogleReserve] = useState(false);
  const [widgetEnabled, setWidgetEnabled] = useState(false);
  const [mollieStatus, setMollieStatus] = useState<any>(null);
  const [mollieLoading, setMollieLoading] = useState(false);
  const [mollieTestLoading, setMollieTestLoading] = useState(false);
  const canManageBusiness = hasPermission(roles, "settings:business");
  const canManageFinance = hasPermission(roles, "settings:finance");
  const canManageTeam = hasPermission(roles, "settings:team");
  const canManageIntegrations = hasPermission(roles, "settings:integrations");
  const canManageMollie = hasPermission(roles, "mollie:manage");
  const canExport = hasPermission(roles, "reports:export");

  useEffect(() => {
    if (settings.length > 0) {
      const s = settings[0] as any;
      setSalonName(s.salon_name || '');
      setNotifications({ email: s.email_enabled || false, whatsapp: s.whatsapp_enabled || false, push: false });
      setDemoMode(s.demo_mode || false);
      setMollieMode(s.mollie_mode || 'test');
      setPaymentProvider((s.payment_provider === 'viva' ? 'viva' : 'mollie'));
      setPaymentFallback(Boolean(s.payment_provider_fallback_enabled));
      setVivaActivation(String(s.viva_status || 'not_started'));
      setDepositNewClient(s.deposit_new_client ?? true);
      setDepositPct(s.deposit_percentage ?? 50);
      setFullPrepayThreshold(Number(s.full_prepay_threshold) || 150);
      setSkipVip(s.skip_prepay_vip ?? true);
      setDepositNoshow(s.deposit_noshow_risk ?? true);
      setAutoRevenuePaymentMode((s.auto_revenue_payment_mode as any) || "deposit");
      if (s.opening_hours) setOpeningHours(s.opening_hours as OpeningHours);
      setBufferMinutes(s.buffer_minutes ?? 15);
      setMaxBookings(s.max_bookings_simultaneous ?? 1);
      setGroupBookings(s.group_bookings_enabled ?? false);
      setAutoBlockNoshow(s.auto_block_noshow ?? 3);
      setGoogleCalendar(s.google_calendar_enabled ?? false);
      setInstagramBooking(s.instagram_booking_enabled ?? false);
    }
    if (user) setEmail(user.email || '');
  }, [settings, user]);

  // Load profile (city + google review url)
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('city, google_review_url')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data) {
        setCity((data as any).city || '');
        setGoogleReviewUrl((data as any).google_review_url || '');
      }
    })();
  }, [user]);

  // Fetch team members / roles
  useEffect(() => {
    if (!user) return;
    const fetchRoles = async () => {
      const { data } = await (supabase as any).from("user_access").select("*").order("created_at", { ascending: false });
      if (data) setTeamMembers(data);
    };
    fetchRoles();
  }, [user]);

  useEffect(() => {
    if (!user || !canManageIntegrations) return;
    fetchMollieStatus();
    // Load Viva status from edge function
    supabase.functions.invoke("viva-status", { body: {} }).then(({ data }) => {
      if (data && typeof data === "object") setVivaStatus(data as any);
    }).catch(() => {});
    // Load Viva webhook diagnostics
    (async () => {
      try {
        const [recv, proc, failed, totalHits, lastPost, latestDebug, malformed] = await Promise.all([
          (supabase as any).from("viva_webhook_events").select("created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
          (supabase as any).from("viva_webhook_events").select("processed_at").eq("user_id", user.id).eq("processed", true).order("processed_at", { ascending: false }).limit(1).maybeSingle(),
          (supabase as any).from("viva_webhook_events").select("id", { count: "exact", head: true }).eq("user_id", user.id).not("error", "is", null),
          (supabase as any).from("viva_webhook_debug_logs").select("id", { count: "exact", head: true }),
          (supabase as any).from("viva_webhook_debug_logs").select("created_at").eq("method", "POST").order("created_at", { ascending: false }).limit(1).maybeSingle(),
          (supabase as any).from("viva_webhook_debug_logs").select("created_at, headers").order("created_at", { ascending: false }).limit(1).maybeSingle(),
          (supabase as any).from("viva_webhook_events").select("id", { count: "exact", head: true }).eq("error", "malformed_or_empty_payload"),
        ]);
        setVivaDiag({
          last_received: (latestDebug?.data as any)?.created_at || (recv?.data as any)?.created_at || null,
          last_processed: (proc?.data as any)?.processed_at || null,
          failed_count: (failed as any)?.count || 0,
          total_hits: (totalHits as any)?.count || 0,
          last_post: (lastPost?.data as any)?.created_at || null,
          malformed_count: (malformed as any)?.count || 0,
          latest_headers: ((latestDebug?.data as any)?.headers as Record<string, unknown>) || null,
        });
      } catch {}
    })();
    // Load Viva readiness checklist from localStorage (per-user)
    try {
      const raw = localStorage.getItem(`viva_checklist_${user.id}`);
      if (raw) setVivaChecklist(JSON.parse(raw));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, canManageIntegrations]);

  const toggleVivaChecklist = (key: string) => {
    setVivaChecklist((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { if (user) localStorage.setItem(`viva_checklist_${user.id}`, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const runVivaTest = async () => {
    setVivaTestLoading(true);
    setVivaTestResult(null);
    try {
      const cents = Math.round(parseFloat(vivaTestAmount.replace(",", ".")) * 100);
      if (!cents || cents < 30) {
        toast.error("Bedrag moet minimaal €0,30 zijn");
        return;
      }
      const { data, error } = await supabase.functions.invoke("create-viva-payment", {
        body: {
          amount_cents: cents,
          payment_type: "other",
          source: "manual",
          description: "Viva test betaling",
          customer: { fullName: vivaTestName, email: vivaTestEmail },
        },
      });
      if (error || (data as any)?.error) {
        toast.error((data as any)?.error || error?.message || "Test mislukt");
        return;
      }
      const res = data as any;
      setVivaTestResult({ checkout_url: res.checkout_url, payment_id: res.payment_id, order_code: res.order_code });
      toast.success("Viva testbetaling aangemaakt");
    } catch (e: any) {
      toast.error(e?.message || "Test mislukt");
    } finally {
      setVivaTestLoading(false);
    }
  };

  const callMollieConnect = async (body: Record<string, any>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Je sessie is verlopen. Log opnieuw in.");
    const { data, error } = await supabase.functions.invoke("mollie-connect", {
      body,
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message || "Mollie actie mislukt");
    return data as any;
  };

  const fetchMollieStatus = async () => {
    try {
      const data = await callMollieConnect({ action: "status" });
      setMollieStatus(data);
    } catch {
      setMollieStatus({ connected: false, error: "Status kon niet worden opgehaald" });
    }
  };

  const mollieMethods = (mollieStatus?.connection?.supported_methods || []) as any[];
  const preferredTestMethod = mollieMethods.find((m) => m.id === "ideal")?.id || mollieMethods[0]?.id || "ideal";

  const handleSyncMollieMethods = async () => {
    if (!canManageMollie) { toast.error("Alleen eigenaren en beheerders kunnen Mollie beheren."); return; }
    setMollieLoading(true);
    try {
      const data = await callMollieConnect({ action: "sync_methods" });
      setMollieStatus((prev: any) => ({ ...(prev || {}), connected: true, connection: data.connection }));
      await fetchMollieStatus();
      const count = (data.connection?.supported_methods || []).length;
      toast.success(count > 0 ? `${count} betaalmethoden gesynchroniseerd` : "Geen actieve betaalmethoden gevonden");
    } catch (err: any) {
      toast.error(err.message || "Betaalmethoden synchroniseren mislukt.");
    } finally {
      setMollieLoading(false);
    }
  };

  const handleOneEuroLiveTest = async () => {
    if (!canManageMollie) { toast.error("Alleen eigenaren en beheerders kunnen Mollie testen."); return; }
    setMollieTestLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Je sessie is verlopen. Log opnieuw in.");
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: {
          amount: 1,
          payment_type: "full",
          method: preferredTestMethod,
          is_demo: false,
          source: "test_button",
          redirect_url: `${window.location.origin}/instellingen?tab=integraties`,
        },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message || "Testbetaling kon niet worden gestart.");
      if (!(data as any)?.checkoutUrl) throw new Error("Mollie gaf geen checkout link terug.");
      window.location.href = (data as any).checkoutUrl;
    } catch (err: any) {
      toast.error(err.message || "€1 testbetaling kon niet worden gestart.");
      setMollieTestLoading(false);
    }
  };

  const handleRefundOneEuroTest = async () => {
    if (!canManageMollie) { toast.error("Alleen eigenaren en beheerders kunnen terugbetalingen testen."); return; }
    setMollieTestLoading(true);
    try {
      const { data: payment, error: readError } = await (supabase as any).from("payments").select("id").eq("amount", 1).eq("status", "paid").eq("is_demo", false).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (readError) throw readError;
      if (!payment) throw new Error("Geen betaalde €1 testbetaling gevonden om terug te betalen.");
      await callMollieConnect({ action: "refund", payment_id: payment.id, reason: "€1 live test refund" });
      toast.success("€1 testterugbetaling gestart");
    } catch (err: any) {
      toast.error(err.message || "Testterugbetaling mislukt.");
    } finally {
      setMollieTestLoading(false);
    }
  };

  const handleConnectMollie = async () => {
    if (!canManageMollie) { toast.error("Alleen eigenaren en beheerders kunnen Mollie koppelen."); return; }
    setMollieLoading(true);
    try {
      const data = await callMollieConnect({ action: "start", redirect_to: "/instellingen?tab=integraties" });
      window.location.href = data.authorizationUrl;
    } catch (err: any) {
      toast.error(err.message || "Mollie koppeling kon niet worden gestart.");
      setMollieLoading(false);
    }
  };

  const handleDisconnectMollie = async () => {
    if (!canManageMollie) { toast.error("Alleen eigenaren en beheerders kunnen Mollie beheren."); return; }
    setMollieLoading(true);
    try {
      await callMollieConnect({ action: "disconnect" });
      toast.success("Mollie is ontkoppeld");
      await fetchMollieStatus();
    } catch (err: any) {
      toast.error(err.message || "Mollie kon niet worden ontkoppeld.");
    } finally {
      setMollieLoading(false);
    }
  };

  const handleSave = async () => {
    if (saveLoading) return;
    if (!canManageBusiness && activeTab !== "betaling") { toast.error("Je hebt geen rechten om deze instellingen te wijzigen."); return; }
    if (activeTab === "betaling" && !canManageFinance) { toast.error("Alleen eigenaren kunnen betaalinstellingen wijzigen."); return; }
    setSaveLoading(true);
    try {
      const data: Record<string, any> = {
        salon_name: salonName,
        email_enabled: notifications.email,
        whatsapp_enabled: notifications.whatsapp,
        mollie_mode: mollieMode,
        payment_provider: paymentProvider,
        payment_provider_fallback_enabled: paymentFallback,
        deposit_new_client: depositNewClient,
        deposit_percentage: depositPct,
        full_prepay_threshold: fullPrepayThreshold,
        skip_prepay_vip: skipVip,
        deposit_noshow_risk: depositNoshow,
        auto_revenue_payment_mode: autoRevenuePaymentMode,
        opening_hours: openingHours,
        buffer_minutes: bufferMinutes,
        max_bookings_simultaneous: maxBookings,
        group_bookings_enabled: groupBookings,
        auto_block_noshow: autoBlockNoshow,
        google_calendar_enabled: googleCalendar,
        instagram_booking_enabled: instagramBooking,
      };
      if (settings.length > 0) {
        await update(settings[0].id, data);
      } else {
        await insert(data);
      }
      // Persist profile fields (city + google review url)
      if (user) {
        const trimmedUrl = googleReviewUrl.trim();
        if (trimmedUrl && !/^https?:\/\//i.test(trimmedUrl)) {
          toast.error("Google review URL moet beginnen met https://");
        } else {
          await supabase
            .from('profiles')
            .upsert(
              { user_id: user.id, city: city.trim() || null, google_review_url: trimmedUrl || null },
              { onConflict: 'user_id' }
            );
        }
      }
      toast.success("Instellingen opgeslagen!");
      refetch();
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDemoReset = async () => {
    if (!demoMode) {
      toast.error("Deze actie is alleen beschikbaar in demo modus.");
      return;
    }
    setResetLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data, error } = await supabase.functions.invoke("seed-demo-data", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message || "Demo omgeving kon niet opnieuw geladen worden.");
        toast.success("Demo data opnieuw geladen!");
        refetch();
      }
    } catch (err: any) {
      toast.error(err.message || "Demo omgeving kon niet opnieuw geladen worden.");
    } finally {
      setResetLoading(false);
    }
  };

  const handleAddTeamMember = async () => {
    if (addUserLoading) return;
    if (!canManageTeam) { toast.error("Alleen eigenaren kunnen gebruikers beheren."); return; }
    if (!newUserName.trim()) { toast.error("Vul een naam in"); return; }
    if (!newUserEmail.trim()) { toast.error("Vul een e-mail in"); return; }
    if (newUserPassword.length < 8) { toast.error("Tijdelijk wachtwoord moet minimaal 8 tekens zijn"); return; }
    setAddUserLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("create-user", {
        body: { name: newUserName.trim(), email: newUserEmail.trim(), password: newUserPassword, role: newUserRole },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || (data as any)?.error) {
        throw new Error((data as any)?.error || error?.message || "Aanmaken mislukt");
      }
      toast.success(`Gebruiker ${newUserName} aangemaakt`);
      setNewUserName(""); setNewUserEmail(""); setNewUserPassword(""); setNewUserRole("medewerker");
      const { data: rolesData } = await (supabase as any).from("user_access").select("*").order("created_at", { ascending: false });
      if (rolesData) setTeamMembers(rolesData);
    } catch (err: any) {
      toast.error(err.message || "Aanmaken mislukt");
    } finally {
      setAddUserLoading(false);
    }
  };

  const handleRemoveTeamMember = async (id: string) => {
    if (!canManageTeam) { toast.error("Alleen eigenaren kunnen gebruikers beheren."); return; }
    const member = teamMembers.find((m) => m.id === id);
    if (!member) return;
    const { error } = await (supabase as any).from("user_access").update({ status: "disabled" }).eq("id", id);
    if (!error && member.member_user_id) await (supabase.from("user_roles") as any).delete().eq("user_id", member.member_user_id);
    if (error) { toast.error("Toegang intrekken mislukt"); return; }
    toast.success("Toegang ingetrokken");
    const { data } = await (supabase as any).from("user_access").select("*").order("created_at", { ascending: false });
    if (data) setTeamMembers(data);
  };


  const handleExportCustomers = (format: 'csv' | 'excel') => {
    if (!canExport) { toast.error("Je hebt geen rechten om data te exporteren."); return; }
    const headers = ["Naam", "Telefoon", "E-mail", "Totaal besteed", "VIP", "No-shows"];
    const rows = customers.map(c => [
      c.name, c.phone || '', c.email || '',
      formatEuro(Number(c.total_spent) || 0),
      c.is_vip ? 'Ja' : 'Nee',
      String(c.no_show_count || 0),
    ]);
    if (format === 'csv') exportCSV(headers, rows, "klanten-export.csv");
    else exportExcel(headers, rows, "klanten-export.xls");
    toast.success(`Klanten geëxporteerd als ${format.toUpperCase()}`);
  };

  const handleExportAppointments = (format: 'csv' | 'excel') => {
    if (!canExport) { toast.error("Je hebt geen rechten om data te exporteren."); return; }
    const headers = ["Datum", "Klant", "Behandeling", "Prijs", "Status", "Betaalstatus"];
    const rows = appointments.map(a => {
      const cust = customers.find(c => c.id === a.customer_id);
      const svc = services.find(s => s.id === a.service_id);
      return [
        new Date(a.appointment_date).toLocaleDateString('nl-NL'),
        cust?.name || '—', svc?.name || '—',
        formatEuro(Number(a.price) || 0),
        a.status, a.payment_status || 'geen',
      ];
    });
    if (format === 'csv') exportCSV(headers, rows, "afspraken-export.csv");
    else exportExcel(headers, rows, "afspraken-export.xls");
    toast.success(`Afspraken geëxporteerd als ${format.toUpperCase()}`);
  };

  const handleExportRevenue = (format: 'csv' | 'excel') => {
    if (!canExport) { toast.error("Je hebt geen rechten om omzet te exporteren."); return; }
    const headers = ["Datum", "Klant", "Behandeling", "Bedrag", "Status"];
    const paid = appointments.filter(a => a.status === 'voltooid');
    const rows = paid.map(a => {
      const cust = customers.find(c => c.id === a.customer_id);
      const svc = services.find(s => s.id === a.service_id);
      return [
        new Date(a.appointment_date).toLocaleDateString('nl-NL'),
        cust?.name || '—', svc?.name || '—',
        formatEuro(Number(a.price) || 0), 'Voltooid',
      ];
    });
    if (format === 'csv') exportCSV(headers, rows, "omzet-export.csv");
    else exportExcel(headers, rows, "omzet-export.xls");
    toast.success(`Omzet geëxporteerd als ${format.toUpperCase()}`);
  };

  const ToggleSwitch = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <span
      onClick={(e) => { e.preventDefault(); onChange(!value); }}
      className="inline-flex shrink-0 items-center justify-center min-h-[44px] min-w-[44px] cursor-pointer"
    >
      <Switch checked={value} onCheckedChange={onChange} />
    </span>
  );

  const tabs = [
    { id: "algemeen", label: "Salon", icon: Building },
    { id: "agenda", label: "Agenda", icon: Calendar },
    { id: "boekingen", label: "Online Boeken", icon: Globe },
    { id: "betaling", label: "Payments", icon: CreditCard },
    { id: "klanten", label: "Klanten", icon: Users },
    { id: "integraties", label: "Integrations", icon: Plug },
    { id: "export", label: "Branding & Export", icon: Download },
    { id: "import", label: "Data importeren", icon: FileUp },
    { id: "rollen", label: "Team", icon: UserCog },
    { id: "demo", label: "Demo", icon: Shield },
  ].filter((tab) => {
    if (tab.id === "betaling") return canManageFinance;
    if (tab.id === "export") return canExport;
    if (tab.id === "rollen") return canManageTeam;
    if (tab.id === "integraties") return canManageIntegrations;
    if (tab.id === "demo") return isOwner;
    if (tab.id === "import") return canManageBusiness;
    return canManageBusiness;
  });

  const integrations = [
    { name: "GlowPay (Mollie)", desc: "Online betalingen en aanbetalingen", enabled: mollieMode !== '', icon: CreditCard, toggle: undefined },
    { name: "Google Calendar", desc: "Synchroniseer je agenda met Google", enabled: googleCalendar, toggle: () => setGoogleCalendar(!googleCalendar), icon: Calendar },
    { name: "WhatsApp", desc: "Stuur berichten en herinneringen", enabled: notifications.whatsapp, toggle: () => setNotifications(p => ({ ...p, whatsapp: !p.whatsapp })), icon: Bell },
    { name: "E-mail", desc: "Bevestigingen en marketing e-mails", enabled: notifications.email, toggle: () => setNotifications(p => ({ ...p, email: !p.email })), icon: Bell },
    { name: "Instagram Boekingen", desc: "Boekingslink voor Instagram profiel", enabled: instagramBooking, toggle: () => setInstagramBooking(!instagramBooking), icon: Instagram },
    { name: "Facebook Boekingen", desc: "Boekingslink voor Facebook pagina", enabled: facebookEnabled, toggle: () => setFacebookEnabled(!facebookEnabled), icon: Facebook },
    { name: "Google Reserve", desc: "Reserveringen via Google zoekresultaten", enabled: googleReserve, toggle: () => setGoogleReserve(!googleReserve), icon: Globe },
    { name: "Website Widget", desc: "Boekingswidget voor je website of social media", enabled: widgetEnabled, toggle: () => setWidgetEnabled(!widgetEnabled), icon: ExternalLink },
  ];

  const roleDescriptions = [
    { role: "Eigenaar", perms: "Volledige toegang tot alle functies, instellingen en gebruikersbeheer", color: "bg-primary/15 text-primary" },
    { role: "Admin", perms: "Beheer, rapporten, marketing en klantinzicht — geen gebruikersbeheer", color: "bg-primary/10 text-primary" },
    { role: "Medewerker", perms: "Alleen eigen agenda, afspraken beheren en klantgegevens bekijken", color: "bg-secondary text-muted-foreground" },
    { role: "Financieel", perms: "Alleen rapporten, omzet, betalingen en exports bekijken — geen bewerkingen", color: "bg-warning/15 text-warning" },
  ];

  return (
    <AppLayout title="Instellingen" subtitle="Account en saloninstellingen">
      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-3 mb-8 -mx-1 px-1 border-b border-border/50 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 min-h-10 px-4 py-2.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
              activeTab === t.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            }`}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 sm:gap-8 max-w-3xl">
        {/* Algemeen */}
        {activeTab === "algemeen" && (
          <>
            <SnelleSetupCard />
            <div className="glass-card p-6">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Building className="w-4 h-4 text-primary" /> Salon</h3>
              <div className="space-y-4">
                <div><label className="text-xs text-muted-foreground">Salonnaam</label><input value={salonName} onChange={(e) => setSalonName(e.target.value)} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-xs text-muted-foreground">Stad</label><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Bijv. Amsterdam" className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-xs text-muted-foreground">Telefoon</label><input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div>
                  <label className="text-xs text-muted-foreground">Google review URL</label>
                  <input
                    value={googleReviewUrl}
                    onChange={(e) => setGoogleReviewUrl(e.target.value)}
                    placeholder="https://g.page/r/..."
                    type="url"
                    inputMode="url"
                    className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Wordt getoond aan klanten die een 5-sterren review geven.</p>
                </div>
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
          </>
        )}

        {/* Agenda Settings - FIXED DAY ORDER */}
        {activeTab === "agenda" && (
          <>
            <div className="glass-card p-6">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> Openingstijden</h3>
              <div className="space-y-3">
                {dayOrder.map((day) => {
                  const hours = openingHours[day] || defaultHours[day];
                  return (
                    <div key={day} className="flex items-center gap-3 py-2">
                      <ToggleSwitch value={hours.enabled} onChange={(v) => setOpeningHours(prev => ({ ...prev, [day]: { ...prev[day], enabled: v } }))} />
                      <span className="text-sm font-medium w-24">{dayLabels[day]}</span>
                      {hours.enabled ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input type="time" value={hours.open}
                            onChange={e => setOpeningHours(prev => ({ ...prev, [day]: { ...prev[day], open: e.target.value } }))}
                            className="px-2 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm" />
                          <span className="text-xs text-muted-foreground">tot</span>
                          <input type="time" value={hours.close}
                            onChange={e => setOpeningHours(prev => ({ ...prev, [day]: { ...prev[day], close: e.target.value } }))}
                            className="px-2 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm" />
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Gesloten</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="glass-card p-6">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Calendar className="w-4 h-4 text-primary" /> Agenda instellingen</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm">Buffer tijd tussen afspraken</span>
                    <p className="text-[11px] text-muted-foreground">Vrije tijd tussen twee afspraken</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <input type="number" min={0} max={60} value={bufferMinutes} onChange={e => setBufferMinutes(Number(e.target.value))}
                      className="w-16 px-2 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm text-right" />
                    <span className="text-sm text-muted-foreground">min</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Online Booking Settings */}
        {activeTab === "boekingen" && (
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Globe className="w-4 h-4 text-primary" /> Online boekingen</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm">Aanbetaling verplicht</span>
                  <p className="text-[11px] text-muted-foreground">Vereis aanbetaling bij online boekingen</p>
                </div>
                <ToggleSwitch value={depositNewClient} onChange={setDepositNewClient} />
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm">Max gelijktijdige boekingen</span>
                  <p className="text-[11px] text-muted-foreground">Hoeveel boekingen tegelijk per tijdslot</p>
                </div>
                <input type="number" min={1} max={10} value={maxBookings} onChange={e => setMaxBookings(Number(e.target.value))}
                  className="w-16 px-2 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm text-right" />
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm">Groepsboekingen</span>
                  <p className="text-[11px] text-muted-foreground">Sta toe dat klanten meerdere personen boeken</p>
                </div>
                <ToggleSwitch value={groupBookings} onChange={setGroupBookings} />
              </div>
            </div>
          </div>
        )}

        {/* Messaging automation settings (WhatsApp + SMS) */}
        {activeTab === "boekingen" && <MessagingSettingsCard />}

        {/* White-label embed for salon websites */}
        {activeTab === "boekingen" && <WhiteLabelEmbedCard />}

        {/* Payment Settings */}
        {activeTab === "betaling" && (
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" /> Betaalinstellingen</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div><span className="text-sm">Mollie modus</span><p className="text-[11px] text-muted-foreground">Test of live betalingen</p></div>
                <select value={mollieMode} onChange={(e) => setMollieMode(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm">
                  <option value="test">Test</option><option value="live">Live</option>
                </select>
              </div>
              <div className="flex items-center justify-between py-2">
                <div><span className="text-sm">Aanbetaling nieuwe klant</span><p className="text-[11px] text-muted-foreground">Vereis aanbetaling van nieuwe klanten</p></div>
                <ToggleSwitch value={depositNewClient} onChange={setDepositNewClient} />
              </div>
              <div className="flex items-center justify-between py-2">
                <div><span className="text-sm">Aanbetaling percentage</span><p className="text-[11px] text-muted-foreground">Percentage van de totaalprijs</p></div>
                <div className="flex items-center gap-1">
                  <input type="number" min={10} max={100} value={depositPct} onChange={(e) => setDepositPct(Number(e.target.value))}
                    className="w-16 px-2 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm text-right" /><span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <div className="flex items-center justify-between py-2">
                <div><span className="text-sm">Volledige betaling vanaf</span><p className="text-[11px] text-muted-foreground">Vereis volledige betaling boven dit bedrag</p></div>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">€</span>
                  <input type="number" min={0} value={fullPrepayThreshold} onChange={(e) => setFullPrepayThreshold(Number(e.target.value))}
                    className="w-20 px-2 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm text-right" />
                </div>
              </div>
              <div className="flex items-center justify-between py-2">
                <div><span className="text-sm">VIP overslaan</span><p className="text-[11px] text-muted-foreground">VIP klanten betalen niet vooraf</p></div>
                <ToggleSwitch value={skipVip} onChange={setSkipVip} />
              </div>
              <div className="flex items-center justify-between py-2">
                <div><span className="text-sm">No-show risico aanbetaling</span><p className="text-[11px] text-muted-foreground">Vereis aanbetaling bij no-show risico</p></div>
                <ToggleSwitch value={depositNoshow} onChange={setDepositNoshow} />
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-sm font-semibold mb-2">Auto Revenue betaling</p>
                <p className="text-[11px] text-muted-foreground mb-3">Hoe wordt een JA-reactie via WhatsApp bevestigd?</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {([
                    { v: "none", title: "Geen betaling vooraf", desc: "Direct bevestigd, geen betaallink" },
                    { v: "deposit", title: "Aanbetaling", desc: "Slot vasthouden, aanbetaling vereist" },
                    { v: "full", title: "Volledige betaling", desc: "Volledige prijs vooraf vereist" },
                  ] as const).map((opt) => {
                    const active = autoRevenuePaymentMode === opt.v;
                    return (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setAutoRevenuePaymentMode(opt.v)}
                        className={`text-left p-3 rounded-xl border transition ${active ? "border-primary bg-primary/10" : "border-border bg-secondary/30 hover:bg-secondary/50"}`}
                      >
                        <p className="text-xs font-semibold">{opt.title}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</p>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 p-3 rounded-xl bg-primary/5 border border-primary/10">
                  {(() => {
                    const sample = 50;
                    let amount = 0;
                    if (autoRevenuePaymentMode === "none") amount = 0;
                    else if (autoRevenuePaymentMode === "full") amount = sample + 0.35;
                    else amount = Math.max(5, Math.min(25, (sample * depositPct) / 100)) + 0.35;
                    return (
                      <p className="text-[11px] text-muted-foreground">
                        Bij een behandeling van €{sample} betaalt klant:{" "}
                        <span className="font-semibold text-foreground">
                          {amount === 0 ? "€0 (geen betaling vooraf)" : `€${amount.toFixed(2)}`}
                        </span>
                        {amount > 0 && " (incl. €0,35 platformkosten)"}
                      </p>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Customer Settings */}
        {activeTab === "klanten" && (
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-primary" /> Klantinstellingen</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm">Auto-blokkade no-shows</span>
                  <p className="text-[11px] text-muted-foreground">Blokkeer klant automatisch na x no-shows</p>
                </div>
                <div className="flex items-center gap-1">
                  <input type="number" min={1} max={10} value={autoBlockNoshow} onChange={e => setAutoBlockNoshow(Number(e.target.value))}
                    className="w-16 px-2 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm text-right" />
                  <span className="text-sm text-muted-foreground">x</span>
                </div>
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm">No-show risico aanbetaling</span>
                  <p className="text-[11px] text-muted-foreground">Vereis automatisch aanbetaling bij risicoverleden</p>
                </div>
                <ToggleSwitch value={depositNoshow} onChange={setDepositNoshow} />
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm">VIP herkenning</span>
                  <p className="text-[11px] text-muted-foreground">VIP klanten overslaan bij verplichte aanbetaling</p>
                </div>
                <ToggleSwitch value={skipVip} onChange={setSkipVip} />
              </div>
              <div className="p-3 rounded-xl bg-primary/5 border border-primary/10">
                <p className="text-xs text-muted-foreground">
                  💡 <strong>VIP herkenning:</strong> Klanten met meer dan €500 besteed en 5+ bezoeken worden automatisch als VIP gemarkeerd.
                  <strong> Risico klanten:</strong> Klanten met no-shows of meer dan 2 annuleringen worden als risico gemarkeerd.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Integrations - Enhanced with widget cards */}
        {activeTab === "integraties" && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Plug className="w-4 h-4 text-primary" /> Integraties</h3>

            {/* Payment Provider Selector */}
            <div className="glass-card p-4 flex flex-col gap-3 border border-primary/10">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-primary/15">
                  <CreditCard className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Betaalprovider</p>
                  <p className="text-[11px] text-muted-foreground">Kies welk platform online betalingen verwerkt.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentProvider("mollie")}
                  className={`text-left rounded-xl border p-3 transition ${paymentProvider === "mollie" ? "border-primary bg-primary/5" : "border-border bg-background hover:border-primary/40"}`}
                >
                  <p className="text-sm font-semibold">Mollie</p>
                  <p className="text-[11px] text-muted-foreground">iDEAL, Bancontact, kaart</p>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentProvider("viva")}
                  className={`text-left rounded-xl border p-3 transition ${paymentProvider === "viva" ? "border-primary bg-primary/5" : "border-border bg-background hover:border-primary/40"}`}
                >
                  <p className="text-sm font-semibold">Viva Smart Checkout</p>
                  <p className="text-[11px] text-muted-foreground">Kaart, wallets, lokaal</p>
                </button>
              </div>
              {/* Provider status labels */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="rounded-lg border border-border bg-secondary/30 p-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium">Mollie</span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-success/15 text-success">Fallback actief</span>
                </div>
                <div className="rounded-lg border border-border bg-secondary/30 p-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium">Viva</span>
                  {paymentProvider !== "viva" ? (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-secondary text-muted-foreground">Niet actief</span>
                  ) : vivaStatus?.environment === "live" && vivaStatus?.configured ? (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-success/15 text-success">Klaar voor live</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-warning/15 text-warning">Testmodus</span>
                  )}
                </div>
              </div>

              {paymentProvider === "viva" && (
                <div className="space-y-3">
                  {!vivaStatus?.configured && (
                    <div className="rounded-lg bg-warning/10 border border-warning/30 p-3 text-[11px] text-warning-foreground">
                      Viva credentials of source code ontbreken. Vraag GlowSuite support om je account te activeren.
                    </div>
                  )}

                  {/* Viva readiness checklist */}
                  <div className="rounded-xl border border-border bg-background/60 p-3">
                    <p className="text-xs font-semibold mb-2">Viva readiness checklist</p>
                    <div className="space-y-1.5">
                      {[
                        { key: "credentials", label: "Credentials aanwezig", auto: Boolean(vivaStatus?.credentials_present) },
                        { key: "source_code", label: "Source code aanwezig", auto: Boolean(vivaStatus?.source_code_present) },
                        { key: "demo_test", label: "Demo betaling getest", auto: false },
                        { key: "webhook_received", label: "Webhook ontvangen", auto: false },
                        { key: "appointment_confirmed", label: "Betaalde afspraak bevestigd", auto: false },
                        { key: "failure_handled", label: "Mislukte betaling verwerkt", auto: false },
                        { key: "auto_revenue", label: "Auto Revenue payment link getest", auto: false },
                      ].map((item) => {
                        const checked = item.auto || Boolean(vivaChecklist[item.key]);
                        return (
                          <label key={item.key} className="flex items-center gap-2 text-[11px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={item.auto}
                              onChange={() => !item.auto && toggleVivaChecklist(item.key)}
                              className="h-3.5 w-3.5 rounded border-border accent-primary"
                            />
                            <span className={checked ? "text-foreground" : "text-muted-foreground"}>{item.label}</span>
                            {item.auto && <span className="text-[10px] text-success ml-auto">auto</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Fallback toggle */}
                  <div className="rounded-xl border border-border bg-background/60 p-3 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium">Automatisch terugvallen op Mollie</p>
                      <p className="text-[10px] text-muted-foreground">Bij een Viva-fout wordt de betaling automatisch via Mollie afgehandeld.</p>
                    </div>
                    <Switch checked={paymentFallback} onCheckedChange={setPaymentFallback} />
                  </div>

                  {/* Webhook URL */}
                  <div className="rounded-xl border border-border bg-background/60 p-3">
                    <p className="text-[11px] font-semibold mb-1">Webhook URL</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-[10px] bg-muted/50 rounded px-2 py-1 break-all">{vivaWebhookUrl}</code>
                      <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => { navigator.clipboard.writeText(vivaWebhookUrl); toast.success("Gekopieerd"); }}>Kopieer</Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">Voeg deze URL toe in je Viva Smart Checkout webhook-instellingen.</p>
                  </div>

                  {/* Diagnostics */}
                  <div className="rounded-xl border border-border bg-background/60 p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold">Viva diagnostiek</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${vivaActivation === "active" ? "bg-success/15 text-success" : vivaActivation === "rejected" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>
                        Activatie: {vivaActivation.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                      <div>
                        <p className="text-muted-foreground">Laatst ontvangen</p>
                        <p className="font-medium">{vivaDiag?.last_received ? new Date(vivaDiag.last_received).toLocaleString("nl-NL") : "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Webhook hits</p>
                        <p className="font-medium">{vivaDiag?.total_hits ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Laatste POST</p>
                        <p className="font-medium">{vivaDiag?.last_post ? new Date(vivaDiag.last_post).toLocaleString("nl-NL") : "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Malformed</p>
                        <p className={`font-medium ${vivaDiag && vivaDiag.malformed_count > 0 ? "text-destructive" : ""}`}>{vivaDiag?.malformed_count ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Laatst verwerkt</p>
                        <p className="font-medium">{vivaDiag?.last_processed ? new Date(vivaDiag.last_processed).toLocaleString("nl-NL") : "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Mislukt</p>
                        <p className={`font-medium ${vivaDiag && vivaDiag.failed_count > 0 ? "text-destructive" : ""}`}>{vivaDiag?.failed_count ?? 0}</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-border">
                      <p className="text-[10px] text-muted-foreground mb-1">Laatste headers</p>
                      <pre className="max-h-28 overflow-auto rounded-md bg-muted/50 p-2 text-[9px] leading-relaxed whitespace-pre-wrap break-all">
                        {vivaDiag?.latest_headers ? JSON.stringify(vivaDiag.latest_headers, null, 2) : "—"}
                      </pre>
                    </div>
                  </div>

                  {/* Test panel */}
                  {isOwner && (
                    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
                      <p className="text-[11px] font-semibold">Test Viva Smart Checkout</p>
                      <div className="grid grid-cols-3 gap-2">
                        <input type="number" step="0.01" min="0.30" value={vivaTestAmount} onChange={(e) => setVivaTestAmount(e.target.value)} className="text-[11px] h-8 rounded-md border border-border bg-background px-2" placeholder="Bedrag €" />
                        <input type="text" value={vivaTestName} onChange={(e) => setVivaTestName(e.target.value)} className="text-[11px] h-8 rounded-md border border-border bg-background px-2" placeholder="Naam" />
                        <input type="email" value={vivaTestEmail} onChange={(e) => setVivaTestEmail(e.target.value)} className="text-[11px] h-8 rounded-md border border-border bg-background px-2" placeholder="E-mail" />
                      </div>
                      <Button type="button" size="sm" disabled={vivaTestLoading} onClick={runVivaTest} className="w-full h-8 text-[11px]">
                        {vivaTestLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Maak Viva testbetaling"}
                      </Button>
                      {vivaTestResult && (
                        <div className="text-[10px] space-y-1 pt-1 border-t border-border">
                          <p><span className="text-muted-foreground">Order code:</span> <code>{vivaTestResult.order_code}</code></p>
                          <p><span className="text-muted-foreground">Payment ID:</span> <code className="break-all">{vivaTestResult.payment_id}</code></p>
                          <a href={vivaTestResult.checkout_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            Open Viva Checkout <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">Standaard: Mollie. Viva wordt de standaard provider zodra alle tests groen zijn.</p>

            </div>

            <div className="glass-card p-4 flex flex-col gap-4 border border-primary/10">
              <div className="flex items-start gap-3">

                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${mollieStatus?.connected ? "bg-success/15" : "bg-secondary/50"}`}>
                  <CreditCard className={`w-5 h-5 ${mollieStatus?.connected ? "text-success" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">Mollie Connect</p>
                    <span className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold ${mollieStatus?.connected ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"}`}>
                      {mollieStatus?.connected ? "Verbonden" : "Niet verbonden"}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Salons ontvangen betalingen rechtstreeks op hun eigen Mollie account</p>
                </div>
              </div>
              {mollieStatus?.connected && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                  <div className="p-2 rounded-lg bg-secondary/40">Account: <span className="text-foreground font-medium">{mollieStatus.connection?.organization_name || mollieStatus.connection?.account_name}</span></div>
                  <div className="p-2 rounded-lg bg-secondary/40">Modus: <span className="text-foreground font-medium">{mollieStatus.connection?.mollie_mode || mollieMode}</span></div>
                  <div className="p-2 rounded-lg bg-secondary/40">Webhook: <span className="text-foreground font-medium">{mollieStatus.connection?.webhook_status || "unknown"}</span></div>
                  <div className="p-2 rounded-lg bg-secondary/40">Laatste sync: <span className="text-foreground font-medium">{mollieStatus.connection?.last_sync_at ? new Date(mollieStatus.connection.last_sync_at).toLocaleDateString("nl-NL") : "—"}</span></div>
                  <div className="sm:col-span-2 p-2 rounded-lg bg-secondary/40">
                    Methoden: <span className="text-foreground font-medium">{mollieMethods.map((m: any) => m.description || m.id).join(", ") || "Nog niet gesynchroniseerd"}</span>
                  </div>
                </div>
              )}
              {mollieStatus?.demo && <div className="p-3 rounded-xl bg-secondary/50 text-xs text-muted-foreground">Demo modus gebruikt geen echte Mollie-koppeling en simuleert betalingen veilig.</div>}
              <div className="flex gap-2 flex-wrap">
                <Button variant="gradient" size="sm" onClick={handleConnectMollie} disabled={mollieLoading || mollieStatus?.demo}>
                  {mollieLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  {mollieStatus?.connected ? "Opnieuw verbinden" : "Koppel Mollie"}
                </Button>
                {mollieStatus?.connected && <Button variant="outline" size="sm" onClick={handleDisconnectMollie} disabled={mollieLoading}>Ontkoppelen</Button>}
                {mollieStatus?.connected && <Button variant="outline" size="sm" onClick={handleSyncMollieMethods} disabled={mollieLoading}>
                  {mollieLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Methoden syncen
                </Button>}
                {mollieStatus?.connected && canManageMollie && (
                  <>
                    <Button variant="outline" size="sm" onClick={handleOneEuroLiveTest} disabled={mollieTestLoading || mollieStatus.connection?.mollie_mode !== "live"}>
                      {mollieTestLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />} €1 live test
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleRefundOneEuroTest} disabled={mollieTestLoading || mollieStatus.connection?.mollie_mode !== "live"}>
                      <RotateCcw className="w-4 h-4" /> Refund test
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {integrations.map((intg, i) => (
                <div key={i} className="glass-card p-4 flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${intg.enabled ? 'bg-primary/15' : 'bg-secondary/50'}`}>
                      <intg.icon className={`w-5 h-5 ${intg.enabled ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{intg.name}</p>
                      <p className="text-[11px] text-muted-foreground">{intg.desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    {intg.enabled ? (
                      <span className="flex items-center gap-1 text-[11px] text-success font-medium"><CheckCircle2 className="w-3.5 h-3.5" />Ingeschakeld</span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><XCircle className="w-3.5 h-3.5" />Uitgeschakeld</span>
                    )}
                    {intg.toggle && (
                      <Button variant={intg.enabled ? "outline" : "gradient"} size="sm" onClick={intg.toggle}>
                        {intg.enabled ? "Uitschakelen" : "Inschakelen"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Data Export */}
        {activeTab === "export" && (
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Download className="w-4 h-4 text-primary" /> Data export</h3>
            <div className="space-y-4">
              {[
                { label: "Klanten", desc: `${customers.length} klanten`, onCSV: () => handleExportCustomers('csv'), onExcel: () => handleExportCustomers('excel') },
                { label: "Afspraken", desc: `${appointments.length} afspraken`, onCSV: () => handleExportAppointments('csv'), onExcel: () => handleExportAppointments('excel') },
                { label: "Omzet", desc: "Voltooide afspraken", onCSV: () => handleExportRevenue('csv'), onExcel: () => handleExportRevenue('excel') },
              ].map((exp, i) => (
                <div key={i} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                  <div>
                    <p className="text-sm font-medium">{exp.label}</p>
                    <p className="text-[11px] text-muted-foreground">{exp.desc}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={exp.onCSV}><Download className="w-3.5 h-3.5 mr-1" />CSV</Button>
                    <Button variant="outline" size="sm" onClick={exp.onExcel}><Download className="w-3.5 h-3.5 mr-1" />Excel</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "import" && <ImportWizard />}

        {/* User Roles - Enhanced with add/remove */}
        {activeTab === "rollen" && (
          <div className="space-y-8">
            <div className="glass-card p-6">
              <h3 className="text-sm font-semibold mb-5 flex items-center gap-2"><UserCog className="w-4 h-4 text-primary" /> Gebruikers</h3>
              <div className="space-y-3">
                {/* Current user */}
                <div className="flex items-center gap-4 p-4 rounded-xl bg-secondary/50 border border-border">
                  <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-primary-foreground">{(user?.email?.charAt(0) || 'U').toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{user?.email?.split('@')[0] || 'Gebruiker'}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{user?.email}</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-primary/15 text-primary text-[11px] font-semibold flex-shrink-0">Eigenaar</span>
                </div>

                {/* Team members from DB */}
                {teamMembers.filter(m => m.user_id !== user?.id).map((member) => (
                  <div key={member.id} className="flex items-center gap-4 p-4 rounded-xl bg-secondary/30 border border-border">
                    <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                      <UserCog className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{member.name || member.email}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{member.email} · {member.status === "disabled" ? "Geblokkeerd" : "Actief"}</p>
                    </div>
                    <span className="px-2 py-1 rounded-lg bg-secondary text-[11px] text-muted-foreground capitalize">{member.role}</span>
                    <button onClick={() => handleRemoveTeamMember(member.id)} disabled={member.status === "disabled"} className="p-2 rounded-lg hover:bg-destructive/20 transition-colors flex-shrink-0 disabled:opacity-40" aria-label="Verwijderen">
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add new member - direct create */}
              <div className="border-t border-border/60 mt-6 pt-6">
                <p className="text-xs font-medium text-muted-foreground mb-3">Gebruiker aanmaken</p>
                <div className="grid gap-2">
                  <input placeholder="Naam" value={newUserName} onChange={e => setNewUserName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  <input placeholder="E-mail adres" type="email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  <input placeholder="Tijdelijk wachtwoord (min. 8 tekens)" type="text" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  <div className="flex gap-2">
                    <select value={newUserRole} onChange={e => setNewUserRole(e.target.value)}
                      className="flex-1 px-3 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm">
                      <option value="medewerker">Medewerker</option>
                      <option value="receptie">Receptie</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                      <option value="financieel">Financieel</option>
                    </select>
                    <Button variant="gradient" size="sm" onClick={handleAddTeamMember} disabled={addUserLoading}>
                      {addUserLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      <span className="ml-1">Aanmaken</span>
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">De nieuwe gebruiker kan direct inloggen met dit wachtwoord en kan dit zelf wijzigen via "Wachtwoord vergeten".</p>
                </div>
              </div>
            </div>

            {/* Role descriptions */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-semibold mb-5 flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> Rollenoverzicht</h3>
              <div className="space-y-3">
                {roleDescriptions.map((r, i) => (
                  <div key={i} className="flex items-start gap-4 p-4 rounded-xl bg-secondary/30">
                    <span className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex-shrink-0 ${r.color}`}>{r.role}</span>
                    <p className="text-xs text-muted-foreground flex-1 leading-relaxed">{r.perms}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Demo Mode */}
        {activeTab === "demo" && (
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> Demo modus</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div><span className="text-sm">Demo omgeving</span><p className="text-[11px] text-muted-foreground">Alleen demo-accounts kunnen fake data en betalingen gebruiken</p></div>
                <span className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${demoMode ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>
                  {demoMode ? "Actief" : "Live account"}
                </span>
              </div>
              {demoMode ? (
                <>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setConfirmReset(true)} disabled={resetLoading}>
                    {resetLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
                    {resetLoading ? "Laden..." : "Demo opnieuw laden"}
                  </Button>
                  <p className="text-[11px] text-muted-foreground/60 text-center">Reset alleen geïsoleerde demo data, nooit live data</p>
                </>
              ) : (
                <div className="p-3 rounded-xl bg-secondary/50 border border-border text-xs text-muted-foreground">
                  Demo reset, fake data imports en demo betalingen zijn geblokkeerd voor live accounts.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="pt-2">
          <Button onClick={handleSave} className="w-full" size="lg" disabled={saveLoading}>
            {saveLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {saveLoading ? "Opslaan..." : "Opslaan"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Je staat op het punt demo data opnieuw te laden."
        description="Dit reset alleen de geïsoleerde demo omgeving en raakt geen live salondata, echte klanten of echte betalingen."
        confirmLabel="Ja, reset demo"
        confirmationText="RESET DEMO"
        destructive
        onConfirm={handleDemoReset}
      />
    </AppLayout>
  );
}

function MessagingSettingsCard() {
  const [s, setS] = useState<MessageSettings>(getMessageSettings());
  const upd = (patch: Partial<MessageSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveMessageSettings(next);
  };
  return (
    <div className="glass-card p-6 mt-4">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Bell className="w-4 h-4 text-primary" /> Berichtautomatisering</h3>
      <div className="space-y-4">
        <div className="flex items-center justify-between py-2">
          <div><span className="text-sm">WhatsApp automatisering</span><p className="text-[11px] text-muted-foreground">Verstuur automatische WhatsApp berichten</p></div>
          <Switch checked={s.whatsappEnabled} onCheckedChange={(checked) => upd({ whatsappEnabled: checked })} />
        </div>
        <div className="flex items-center justify-between py-2">
          <div><span className="text-sm">SMS automatisering</span><p className="text-[11px] text-muted-foreground">Verstuur automatische SMS-berichten</p></div>
          <Switch checked={s.smsEnabled} onCheckedChange={(checked) => upd({ smsEnabled: checked })} />
        </div>
        <div className="flex items-center justify-between py-2">
          <div><span className="text-sm">Voorkeurskanaal</span><p className="text-[11px] text-muted-foreground">Wat als beide actief zijn</p></div>
          <select value={s.preferredChannel} onChange={e => upd({ preferredChannel: e.target.value as 'whatsapp' | 'sms' })} className="px-3 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm">
            <option value="whatsapp">WhatsApp</option><option value="sms">SMS</option>
          </select>
        </div>
        <div className="flex items-center justify-between py-2">
          <div><span className="text-sm">Max berichten per dag</span><p className="text-[11px] text-muted-foreground">Limiet om spam te voorkomen</p></div>
          <input type="number" min={1} max={1000} value={s.maxPerDay} onChange={e => upd({ maxPerDay: Number(e.target.value) })} className="w-20 px-2 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm text-right" />
        </div>
        <div className="flex items-center justify-between py-2">
          <div><span className="text-sm">Afgebroken boeking opvolgen</span><p className="text-[11px] text-muted-foreground">Stuur reminders na 1u/24u</p></div>
          <Switch checked={s.abandonedFollowupEnabled} onCheckedChange={(checked) => upd({ abandonedFollowupEnabled: checked })} />
        </div>
        <div className="flex items-center justify-between py-2">
          <div><span className="text-sm">Kortingsbericht (3 dagen)</span><p className="text-[11px] text-muted-foreground">Stuur 10% korting bij koude lead</p></div>
          <Switch checked={s.incentiveEnabled} onCheckedChange={(checked) => upd({ incentiveEnabled: checked })} />
        </div>
      </div>
    </div>
  );
}

function SnelleSetupCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className="glass-card p-6">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold mb-1">Snelle setup</h3>
          <p className="text-xs text-muted-foreground mb-3">Configureer je salon in 1 minuut met aanbevolen behandelingen per type.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="gradient" onClick={() => setOpen(true)}>
              <Sparkles className="w-3.5 h-3.5" /> Start setup wizard
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.dispatchEvent(new CustomEvent("glowsuite:start-tour"))}>
              <PlayCircle className="w-3.5 h-3.5" /> Bekijk rondleiding
            </Button>
          </div>
        </div>
      </div>
      <OnboardingWizard open={open} onOpenChange={setOpen} />
    </div>
  );
}

