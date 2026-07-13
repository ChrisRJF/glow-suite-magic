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
  const [remindersSent, setRemindersSent] = useState(0);
  const [confirmed, setConfirmed] = useState(0);
  const [depositsRequested, setDepositsRequested] = useState(0);
  const [deliveryFailed, setDeliveryFailed] = useState(0);

  const todayIso = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    const [wa, remRes, confRes, depRes, failRes] = await Promise.all([
      supabase
        .from("whatsapp_settings")
        .select("send_reminders, send_no_show_followup, send_booking_confirmation")
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
    ]);
    const w: any = wa.data || {};
    setEnabled(!!(w.send_reminders && w.send_no_show_followup && w.send_booking_confirmation));
    setRemindersSent(remRes.count || 0);
    setConfirmed(confRes.count || 0);
    setDepositsRequested(depRes.count || 0);
    setDeliveryFailed(failRes.count || 0);
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

  const toggle = async (next: boolean) => {
    if (!user || !canManage) return;
    setBusy(true);
    setEnabled(next);
    try {
      const patch = {
        send_reminders: next,
        send_no_show_followup: next,
        send_booking_confirmation: next,
      };
      const { data: existing } = await supabase
        .from("whatsapp_settings")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (existing) {
        await supabase.from("whatsapp_settings").update(patch).eq("user_id", user.id);
      } else {
        await supabase.from("whatsapp_settings").insert({ user_id: user.id, ...patch });
      }
      // Zorg dat de bijhorende templates actief staan
      for (const t of ["reminder", "no_show", "booking_confirmation"] as const) {
        const { data: tpl } = await supabase
          .from("whatsapp_templates")
          .update({ is_active: next })
          .eq("user_id", user.id)
          .eq("template_type", t)
          .select("id");
        if (!tpl || tpl.length === 0) {
          await supabase.from("whatsapp_templates").insert({
            user_id: user.id,
            template_type: t,
            is_active: next,
            content: DEFAULT_WHATSAPP_TEMPLATES[t],
          });
        }
      }
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
  ];

  return (
    <Card className="mb-4 overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-section-title">No-show preventie</h2>
            <p className="text-meta mt-1">
              Herinnering, bevestigingsvraag en opvolging na een gemiste afspraak — automatisch.
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

        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <p>
            Wanneer aan, sturen we automatisch een bevestigingslink, herinnering en opvolging.
          </p>
          <Button asChild variant="ghost" size="sm" className="h-8 px-2">
            <Link to="/whatsapp">Berichten bewerken</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
