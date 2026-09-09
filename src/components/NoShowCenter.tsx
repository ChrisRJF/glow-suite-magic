import { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { BellRing, CheckCircle2, AlertTriangle, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useCustomers, useAppointments } from "@/hooks/useSupabaseData";
import { calculateNoShowRisk } from "@/lib/noShowRisk";
import { DEFAULT_WHATSAPP_TEMPLATES } from "@/lib/whatsappTemplates";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * Centrale No-show hub. Eén kaart, één toggle, één waarheid.
 * - Vandaag: reminders verstuurd / bevestigd / hoog risico / aanbetaling gevraagd
 * - Toggle: "No-show preventie" (schakelt reminder + confirmatie + no-show follow-up)
 */
export function NoShowCenter() {
  const { user } = useAuth();
  const { hasAny } = useUserRole();
  const canManage = hasAny("eigenaar", "manager", "admin");
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();

  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hoursBefore, setHoursBefore] = useState(24);
  const [testing, setTesting] = useState(false);
  const [remindersSent, setRemindersSent] = useState(0);
  const [confirmed, setConfirmed] = useState(0);
  const [depositsRequested, setDepositsRequested] = useState(0);
  const [deliveryFailed, setDeliveryFailed] = useState(0);
  const [activeRetries, setActiveRetries] = useState(0);


  const [salonTz, setSalonTz] = useState<string>("Europe/Amsterdam");

  // Compute "today 00:00" in the salon's timezone as a UTC ISO string.
  // Falls back to Europe/Amsterdam if the salon didn't set a timezone.
  const todayIso = useMemo(() => {
    try {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: salonTz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const local = fmt.format(new Date()); // YYYY-MM-DD in salon tz
      // Interpret that local midnight as UTC-safe boundary by asking Intl
      // for the same-instant offset — good enough for a "today so far" bucket.
      return new Date(`${local}T00:00:00`).toISOString();
    } catch {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
  }, [salonTz]);

  const load = useCallback(async () => {
    if (!user) return;
    // Load salon timezone first so subsequent counts respect it.
    const { data: settingsRow } = await supabase
      .from("settings")
      .select("timezone")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (settingsRow?.timezone) setSalonTz(settingsRow.timezone as string);

    const [wa, remRes, confRes, depRes, failRes, retryRes] = await Promise.all([
      supabase
        .from("whatsapp_settings")
        .select("send_reminders, send_no_show_followup, send_booking_confirmation, reminder_hours_before")
        .eq("user_id", user.id)
        .maybeSingle(),

      supabase
        .from("whatsapp_logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("kind", "reminder")
        .eq("status", "sent")
        .gte("created_at", todayIso),
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("confirmation_status", "confirmed")
        .gte("confirmation_responded_at", todayIso),
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("payment_required", true)
        .in("payment_status", ["pending", "open", "requested"])
        .gte("created_at", todayIso),
      supabase
        .from("whatsapp_logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("dead_letter", true)
        .gte("created_at", todayIso),
      supabase
        .from("whatsapp_logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "failed")
        .eq("dead_letter", false)
        .not("next_retry_at", "is", null),
    ]);
    const w: any = wa.data || {};
    setEnabled(!!(w.send_reminders && w.send_no_show_followup && w.send_booking_confirmation));
    setHoursBefore(Number(w.reminder_hours_before) || 24);

    setRemindersSent(remRes.count || 0);
    setConfirmed(confRes.count || 0);
    setDepositsRequested(depRes.count || 0);
    setDeliveryFailed(failRes.count || 0);
    setActiveRetries(retryRes.count || 0);
  }, [user, todayIso]);

  useEffect(() => {
    load();
  }, [load]);

  // Hoog risico vandaag/morgen — via centrale engine
  const highRisk = useMemo(() => {
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + 1);
    end.setHours(23, 59, 59, 999);
    const custMap = new Map((customers as any[]).map((c) => [c.id, c]));
    let count = 0;
    for (const a of appointments as any[]) {
      const when = new Date(a.appointment_date);
      if (when < now || when > end) continue;
      if (a.status === "geannuleerd") continue;
      const c = custMap.get(a.customer_id);
      if (c && calculateNoShowRisk(c).isElevated) count++;
    }
    return count;
  }, [appointments, customers]);

  // Eerstvolgende afspraak met een bereikbare klant — die gebruiken we voor de test.
  const testAppointment = useMemo(() => {
    const now = new Date();
    const custMap = new Map((customers as any[]).map((c) => [c.id, c]));
    return (appointments as any[])
      .filter((a) => {
        if (a.status === "geannuleerd" || a.confirmation_status === "declined") return false;
        if (new Date(a.appointment_date) < now) return false;
        const c = custMap.get(a.customer_id);
        return !!(c && (c.phone || c.email));
      })
      .sort((a, b) => +new Date(a.appointment_date) - +new Date(b.appointment_date))[0] || null;
  }, [appointments, customers]);

  const sendTest = async () => {
    if (!user || !canManage || testing) return;
    if (!testAppointment) {
      toast.error("Geen komende afspraak met een telefoonnummer of e-mailadres gevonden.");
      return;
    }
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-reminder-scheduler", {
        body: { test_appointment_id: testAppointment.id },
      });
      if (error) throw error;
      const res: any = data || {};
      if (res.status === "sent" && res.reason === "demo_simulated") {
        toast.info("Demomodus: bericht is alleen gesimuleerd, er is niets echt verstuurd.");
      } else if (res.status === "sent") {
        toast.success(
          res.channel === "email"
            ? "Verzonden via e-mail"
            : "Verzonden via WhatsApp",
        );
      } else if (res.status === "skipped") {
        const reasons: Record<string, string> = {
          no_contact_details: "Geen geldig nummer of e-mailadres bij deze klant.",
          customer_opted_out: "Deze klant wil geen berichten ontvangen.",
          no_deliverable_channel: "Geen geldig nummer of e-mailadres bij deze klant.",
          no_channel_enabled: "Herinneringen staan uit.",
          recently_sent: "Net al een testbericht verstuurd. Wacht even.",
          appointment_cancelled: "Deze afspraak is geannuleerd.",
        };
        toast.info(reasons[res.reason] || "Niet verstuurd.");
      } else {
        toast.error("Niet afgeleverd. Controleer het nummer van de klant.");
      }
    } catch (e: any) {
      toast.error(e?.message || "Niet afgeleverd.");
    } finally {
      setTesting(false);
      load();
    }
  };


  const toggle = async (next: boolean) => {
    if (!user || !canManage) return;
    setBusy(true);
    setEnabled(next);
    try {
      // Atomic RPC — one transaction upserts whatsapp_settings + all three
      // templates (reminder / no_show / booking_confirmation). No half-states.
      const { error } = await supabase.rpc("set_noshow_prevention", {
        _enabled: next,
        _reminder_template: DEFAULT_WHATSAPP_TEMPLATES.reminder,
        _no_show_template: DEFAULT_WHATSAPP_TEMPLATES.no_show,
        _booking_confirmation_template: DEFAULT_WHATSAPP_TEMPLATES.booking_confirmation,
      });
      if (error) throw error;
      toast.success(next ? "No-show preventie staat aan" : "No-show preventie staat uit");
    } catch (e: any) {
      toast.error(e?.message || "Kon niet opslaan");
      setEnabled(!next);
    } finally {
      setBusy(false);
      load();
    }
  };

  const tiles = [
    { label: "Herinneringen verstuurd", value: remindersSent, icon: BellRing, dot: "bg-emerald-500" },
    { label: "Bevestigd", value: confirmed, icon: CheckCircle2, dot: "bg-emerald-500" },
    { label: "Hoog risico", value: highRisk, icon: AlertTriangle, dot: "bg-amber-500" },
    { label: "Aanbetaling gevraagd", value: depositsRequested, icon: Wallet, dot: "bg-violet-500" },
    ...(activeRetries > 0
      ? [{ label: "Nieuwe poging gepland", value: activeRetries, icon: BellRing, dot: "bg-sky-500" }]
      : []),
    ...(deliveryFailed > 0
      ? [{ label: "Niet afgeleverd", value: deliveryFailed, icon: AlertTriangle, dot: "bg-rose-500" }]
      : []),
  ];

  return (
    <Card className="mb-4 overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-section-title">No-show preventie</h2>
            <p className="text-meta mt-1">
              Automatische herinnering, bevestiging en opvolging.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">{enabled ? "Aan" : "Uit"}</span>
            <Switch
              checked={enabled}
              disabled={!canManage || busy}
              onCheckedChange={toggle}
              aria-label="No-show preventie"
            />
          </div>
        </div>

        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Vandaag</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            {tiles.map((t) => {
              const Icon = t.icon;
              return (
                <div
                  key={t.label}
                  className="rounded-xl border border-border/60 bg-background p-3"
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} />
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">{t.value}</div>
                  <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                    {t.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <p>
            Herinnering: {hoursBefore} uur voor de afspraak · via WhatsApp, anders e-mail
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="gradient"
              size="sm"
              className="h-8 px-3"
              disabled={!canManage || testing || !testAppointment}
              onClick={sendTest}
            >
              {testing ? "Bezig..." : "Test herinnering versturen"}
            </Button>
            <Button asChild variant="ghost" size="sm" className="h-8 px-2">
              <Link to="/whatsapp">Meer instellingen</Link>
            </Button>
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
