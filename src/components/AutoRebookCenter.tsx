import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Repeat, Send, CalendarCheck, Euro, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useServices } from "@/hooks/useSupabaseData";
import { fetchDueRebookCustomers, salonMonthStartIso } from "@/lib/autoRebookClient";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * Auto Rebook hub. Eén kaart, één toggle, dezelfde engine als de backend.
 * Toont per maand: klanten die nu toe zijn, verzonden, geboekt en omzet.
 */
export function AutoRebookCenter() {
  const { user } = useAuth();
  const { hasAny } = useUserRole();
  const canManage = hasAny("eigenaar", "manager", "admin");
  const { data: services } = useServices();

  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const [booked, setBooked] = useState(0);
  const [realized, setRealized] = useState(0);
  const [failed, setFailed] = useState(0);
  const [dueNow, setDueNow] = useState(0);
  const [timezone, setTimezone] = useState<string | null>(null);

  // Salon timezone, never the browser timezone.
  useEffect(() => {
    if (!user) return;
    supabase.from("settings").select("timezone").eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setTimezone((data as any)?.timezone || null));
  }, [user]);

  const monthStart = useMemo(() => salonMonthStartIso(timezone), [timezone]);

  const load = useCallback(async () => {
    if (!user) return;
    const [wa, tpl, actions, failRes] = await Promise.all([
      supabase.from("whatsapp_settings").select("send_revenue_boost").eq("user_id", user.id).maybeSingle(),
      supabase.from("whatsapp_templates").select("is_active").eq("user_id", user.id).eq("template_type", "revenue_boost").maybeSingle(),
      supabase.from("rebook_actions")
        .select("sent_at, booked_at, realized_revenue, realized_at")
        .eq("user_id", user.id).gte("created_at", monthStart),
      supabase.from("whatsapp_logs").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).eq("kind", "auto_rebook").eq("dead_letter", true).gte("created_at", monthStart),
    ]);
    setEnabled(Boolean((wa.data as any)?.send_revenue_boost) && (tpl.data as any)?.is_active !== false);
    const rows = (actions.data as any[]) || [];
    setSent(rows.filter((r) => r.sent_at).length);
    setBooked(rows.filter((r) => r.booked_at).length);
    // Realized only: cancelled, no-show, declined and refunded bookings are
    // reversed by the database and never counted here.
    setRealized(rows.reduce((sum, r) => sum + Number(r.realized_revenue || 0), 0));
    setFailed(failRes.count || 0);
  }, [user, monthStart]);

  useEffect(() => { load(); }, [load]);

  // Klanten die nu toe zijn — server-genarrowd, canonieke engine.
  useEffect(() => {
    let active = true;
    fetchDueRebookCustomers((services as any[]) || []).then((rows) => {
      if (active) setDueNow(rows.length);
    });
    return () => { active = false; };
  }, [services]);

  const toggle = async (next: boolean) => {
    if (!user || !canManage) return;
    setBusy(true);
    setEnabled(next);
    try {
      // Atomic: setting, template and any open retries change in one call.
      const { error } = await supabase.rpc("set_auto_rebook", { _enabled: next });
      if (error) throw error;
      toast.success(next ? "Auto Rebook staat aan" : "Auto Rebook staat uit");
    } catch (e: any) {
      toast.error(e?.message || "Kon niet opslaan");
      setEnabled(!next);
    } finally {
      setBusy(false);
      load();
    }
  };

  const tiles = [
    { label: "Klanten nu toe", value: String(dueNow), icon: Repeat, dot: "bg-violet-500" },
    { label: "Berichten verstuurd", value: String(sent), icon: Send, dot: "bg-emerald-500" },
    { label: "Geboekt via Auto Rebook", value: String(booked), icon: CalendarCheck, dot: "bg-emerald-500" },
    {
      label: "Teruggewonnen omzet",
      value: realized.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }),
      icon: Euro,
      dot: "bg-sky-500",
    },
    ...(failed > 0
      ? [{ label: "Niet afgeleverd", value: String(failed), icon: AlertTriangle, dot: "bg-rose-500" }]
      : []),
  ];

  return (
    <Card className="mb-4 overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-section-title">Auto Rebook</h2>
            <p className="text-meta mt-1">
              We zien wanneer een klant toe is aan een nieuwe afspraak en sturen automatisch een uitnodiging met boekingslink.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">{enabled ? "Aan" : "Uit"}</span>
            <Switch
              checked={enabled}
              disabled={!canManage || busy}
              onCheckedChange={toggle}
              aria-label="Auto Rebook"
            />
          </div>
        </div>

        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Deze maand</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            {tiles.map((t) => {
              const Icon = t.icon;
              return (
                <div key={t.label} className="rounded-xl border border-border/60 bg-background p-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} />
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">{t.value}</div>
                  <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{t.label}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <p>Stel per behandeling een terugkomadvies in. Zonder advies leren we het ritme uit de historie.</p>
          <Button asChild variant="ghost" size="sm" className="h-8 px-2">
            <Link to="/behandelingen">Terugkomadvies instellen</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
