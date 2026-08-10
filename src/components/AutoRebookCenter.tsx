import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Repeat, Send, CalendarCheck, Euro, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useCustomers, useAppointments, useServices } from "@/hooks/useSupabaseData";
import { calculateAutoRebook } from "@/lib/autoRebook";
import { DEFAULT_WHATSAPP_TEMPLATES } from "@/lib/whatsappTemplates";
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
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const { data: services } = useServices();

  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const [booked, setBooked] = useState(0);
  const [revenue, setRevenue] = useState(0);
  const [failed, setFailed] = useState(0);

  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    const [wa, tpl, actions, failRes] = await Promise.all([
      supabase.from("whatsapp_settings").select("send_revenue_boost").eq("user_id", user.id).maybeSingle(),
      supabase.from("whatsapp_templates").select("is_active").eq("user_id", user.id).eq("template_type", "revenue_boost").maybeSingle(),
      supabase.from("rebook_actions").select("sent_at, booked_at, attributed_revenue").eq("user_id", user.id).gte("created_at", monthStart),
      supabase.from("whatsapp_logs").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).eq("kind", "auto_rebook").eq("dead_letter", true).gte("created_at", monthStart),
    ]);
    setEnabled(Boolean((wa.data as any)?.send_revenue_boost) && (tpl.data as any)?.is_active !== false);
    const rows = (actions.data as any[]) || [];
    setSent(rows.filter((r) => r.sent_at).length);
    setBooked(rows.filter((r) => r.booked_at).length);
    setRevenue(rows.reduce((sum, r) => sum + Number(r.attributed_revenue || 0), 0));
    setFailed(failRes.count || 0);
  }, [user, monthStart]);

  useEffect(() => { load(); }, [load]);

  // Klanten die nu toe zijn — zelfde engine als de scheduler gebruikt.
  const dueNow = useMemo(() => {
    const serviceIntervals: Record<string, number | null> = {};
    const servicePrices: Record<string, number | null> = {};
    for (const s of (services as any[]) || []) {
      serviceIntervals[s.id] = s.rebook_interval_days ?? null;
      servicePrices[s.id] = Number(s.price ?? 0) || null;
    }
    const byCustomer = new Map<string, any[]>();
    for (const a of (appointments as any[]) || []) {
      if (!a.customer_id) continue;
      const arr = byCustomer.get(a.customer_id) || [];
      arr.push(a);
      byCustomer.set(a.customer_id, arr);
    }
    let count = 0;
    for (const c of (customers as any[]) || []) {
      const decision = calculateAutoRebook({
        customer_id: c.id,
        appointments: byCustomer.get(c.id) || [],
        serviceIntervals,
        servicePrices,
      });
      if (decision.should_rebook) count++;
    }
    return count;
  }, [customers, appointments, services]);

  const toggle = async (next: boolean) => {
    if (!user || !canManage) return;
    setBusy(true);
    setEnabled(next);
    try {
      const [{ error: setErr }, { error: tplErr }] = await Promise.all([
        supabase.from("whatsapp_settings").upsert(
          { user_id: user.id, send_revenue_boost: next },
          { onConflict: "user_id" },
        ),
        supabase.from("whatsapp_templates").upsert(
          {
            user_id: user.id,
            template_type: "revenue_boost",
            is_active: next,
            content: DEFAULT_WHATSAPP_TEMPLATES.revenue_boost,
          },
          { onConflict: "user_id,template_type", ignoreDuplicates: false },
        ),
      ]);
      if (setErr || tplErr) throw setErr || tplErr;
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
    { label: "Opnieuw geboekt", value: String(booked), icon: CalendarCheck, dot: "bg-emerald-500" },
    {
      label: "Omzet uit Auto Rebook",
      value: revenue.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }),
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
