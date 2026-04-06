import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useSettings, useCustomers, useAppointments, useServices } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { useCrud } from "@/hooks/useCrud";
import {
  User, Building, Bell, Save, CreditCard, Shield, RotateCcw, Loader2,
  Clock, Calendar, Globe, Users, Download, Link2, Plug, CheckCircle2, XCircle,
  UserCog, AlertTriangle,
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { exportCSV, exportExcel } from "@/lib/exportUtils";
import { formatEuro } from "@/lib/data";

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

const dayLabels: Record<string, string> = {
  ma: "Maandag", di: "Dinsdag", wo: "Woensdag", do: "Donderdag",
  vr: "Vrijdag", za: "Zaterdag", zo: "Zondag",
};

export default function InstellingenPage() {
  const { user } = useAuth();
  const { data: settings, refetch } = useSettings();
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const { data: services } = useServices();
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
  // New settings
  const [openingHours, setOpeningHours] = useState<OpeningHours>(defaultHours);
  const [bufferMinutes, setBufferMinutes] = useState(15);
  const [maxBookings, setMaxBookings] = useState(1);
  const [groupBookings, setGroupBookings] = useState(false);
  const [autoBlockNoshow, setAutoBlockNoshow] = useState(3);
  const [googleCalendar, setGoogleCalendar] = useState(false);
  const [instagramBooking, setInstagramBooking] = useState(false);
  const [activeTab, setActiveTab] = useState("algemeen");

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
      // New fields
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

  // Export handlers
  const handleExportCustomers = (format: 'csv' | 'excel') => {
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
    <button onClick={() => onChange(!value)}
      className={`w-10 h-6 rounded-full transition-colors ${value ? "bg-primary" : "bg-secondary"}`}>
      <div className={`w-4 h-4 rounded-full bg-white transition-transform ${value ? "translate-x-5" : "translate-x-1"}`} />
    </button>
  );

  const tabs = [
    { id: "algemeen", label: "Algemeen", icon: Building },
    { id: "agenda", label: "Agenda", icon: Calendar },
    { id: "boekingen", label: "Online Boeken", icon: Globe },
    { id: "betaling", label: "Betalingen", icon: CreditCard },
    { id: "klanten", label: "Klanten", icon: Users },
    { id: "integraties", label: "Integraties", icon: Plug },
    { id: "export", label: "Data Export", icon: Download },
    { id: "rollen", label: "Gebruikers", icon: UserCog },
    { id: "demo", label: "Demo", icon: Shield },
  ];

  const integrations = [
    { name: "GlowPay (Mollie)", desc: "Online betalingen en aanbetalingen", enabled: mollieMode !== '', icon: CreditCard },
    { name: "Google Calendar", desc: "Synchroniseer je agenda met Google", enabled: googleCalendar, toggle: () => setGoogleCalendar(!googleCalendar), icon: Calendar },
    { name: "WhatsApp", desc: "Stuur berichten en herinneringen", enabled: notifications.whatsapp, toggle: () => setNotifications(p => ({ ...p, whatsapp: !p.whatsapp })), icon: Bell },
    { name: "E-mail", desc: "Bevestigingen en marketing e-mails", enabled: notifications.email, toggle: () => setNotifications(p => ({ ...p, email: !p.email })), icon: Bell },
    { name: "Instagram Boekingen", desc: "Boekingslink voor Instagram profiel", enabled: instagramBooking, toggle: () => setInstagramBooking(!instagramBooking), icon: Link2 },
  ];

  return (
    <AppLayout title="Instellingen" subtitle="Account en saloninstellingen">
      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-2 mb-6 -mx-1 px-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
              activeTab === t.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            }`}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 max-w-2xl">
        {/* Algemeen */}
        {activeTab === "algemeen" && (
          <>
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
          </>
        )}

        {/* Agenda Settings */}
        {activeTab === "agenda" && (
          <>
            <div className="glass-card p-6">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> Openingstijden</h3>
              <div className="space-y-3">
                {Object.entries(openingHours).map(([day, hours]) => (
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
                ))}
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

        {/* Integrations */}
        {activeTab === "integraties" && (
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Plug className="w-4 h-4 text-primary" /> Integraties</h3>
            <div className="space-y-3">
              {integrations.map((intg, i) => (
                <div key={i} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${intg.enabled ? 'bg-primary/15' : 'bg-secondary/50'}`}>
                      <intg.icon className={`w-4 h-4 ${intg.enabled ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{intg.name}</p>
                      <p className="text-[11px] text-muted-foreground">{intg.desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {intg.enabled ? (
                      <span className="flex items-center gap-1 text-[11px] text-success font-medium"><CheckCircle2 className="w-3.5 h-3.5" />Actief</span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><XCircle className="w-3.5 h-3.5" />Inactief</span>
                    )}
                    {intg.toggle && (
                      <ToggleSwitch value={intg.enabled} onChange={() => intg.toggle?.()} />
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

        {/* User Roles */}
        {activeTab === "rollen" && (
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><UserCog className="w-4 h-4 text-primary" /> Gebruikers & Rollen</h3>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-secondary/50 border border-border">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-xl gradient-bg flex items-center justify-center">
                    <span className="text-xs font-bold text-primary-foreground">{(user?.email?.charAt(0) || 'U').toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{user?.email?.split('@')[0] || 'Gebruiker'}</p>
                    <p className="text-[11px] text-muted-foreground">{user?.email}</p>
                  </div>
                  <span className="ml-auto px-2 py-1 rounded-lg bg-primary/15 text-primary text-[11px] font-semibold">Eigenaar</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-primary/5 border border-primary/10">
                <p className="text-xs text-muted-foreground">
                  💡 <strong>Rollen:</strong> Eigenaar (volledige toegang), Admin (beheer & rapporten), Medewerker (agenda & klanten).
                  Nodig medewerkers uit door hun e-mail toe te voegen.
                </p>
              </div>
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground font-medium">Rollenoverzicht</p>
                {[
                  { role: "Eigenaar", perms: "Volledige toegang tot alle functies, instellingen en gebruikersbeheer" },
                  { role: "Admin", perms: "Beheer, rapporten, marketing en klantinzicht" },
                  { role: "Medewerker", perms: "Agenda bekijken, afspraken beheren en klantgegevens zien" },
                ].map((r, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30">
                    <UserCog className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{r.role}</p>
                      <p className="text-[11px] text-muted-foreground">{r.perms}</p>
                    </div>
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
                <div><span className="text-sm">Demo modus actief</span><p className="text-[11px] text-muted-foreground">Simuleer betalingen zonder echte transacties</p></div>
                <ToggleSwitch value={demoMode} onChange={setDemoMode} />
              </div>
              <Button variant="outline" size="sm" className="w-full" onClick={handleDemoReset} disabled={resetLoading}>
                {resetLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
                {resetLoading ? "Laden..." : "Demo opnieuw laden"}
              </Button>
              <p className="text-[11px] text-muted-foreground/60 text-center">Herstelt alle demo data naar de originele staat</p>
            </div>
          </div>
        )}

        <Button onClick={handleSave} className="w-full" size="lg"><Save className="w-4 h-4 mr-2" /> Opslaan</Button>
      </div>
    </AppLayout>
  );
}
