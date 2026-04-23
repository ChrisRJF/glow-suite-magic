import { AppLayout } from "@/components/AppLayout";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { formatEuro } from "@/lib/data";
import { cn } from "@/lib/utils";
import { Activity, BarChart3, Bell, Bot, CalendarClock, CheckCircle2, Clock, FileText, MessageCircle, Plus, Settings, ShieldAlert, Sparkles, ToggleLeft, ToggleRight, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Rule = {
  id: string;
  name?: string | null;
  description?: string | null;
  trigger_type: string;
  action_type: string;
  is_active: boolean;
  config?: Record<string, any> | null;
  conditions?: Record<string, any> | null;
  message_templates?: Record<string, string> | null;
  channel?: string | null;
  delay_value?: number | null;
  delay_unit?: string | null;
  provider_required?: boolean | null;
  last_triggered_at: string | null;
  created_at?: string;
};

type Run = { id: string; automation_rule_id: string; status: string; scheduled_for: string; processed_at: string | null; revenue_attributed: number; channel: string; error_message: string | null; created_at: string };
type Log = { id: string; automation_rule_id: string | null; status: string; event_type: string; message: string; revenue_attributed: number; created_at: string };

const TEMPLATES = [
  { key: "appointment_reminder_24h", group: "Bookings", name: "Afspraak reminder 24u vooraf", trigger: "appointment_reminder_24h", action: "send_email", delay: 0, unit: "instant", channel: "email", nl: "Hi {{first_name}}, morgen staat je afspraak bij {{salon_name}} gepland: {{appointment_date}}.", en: "Hi {{first_name}}, your appointment at {{salon_name}} is tomorrow: {{appointment_date}}." },
  { key: "appointment_reminder_2h", group: "Bookings", name: "Afspraak reminder 2u vooraf", trigger: "appointment_reminder_2h", action: "send_email", delay: 0, unit: "instant", channel: "email", nl: "Hi {{first_name}}, je afspraak bij {{salon_name}} start over ongeveer 2 uur.", en: "Hi {{first_name}}, your appointment at {{salon_name}} starts in about 2 hours." },
  { key: "rebook_30_days", group: "Bookings", name: "Herboek reminder na bezoek", trigger: "rebook_30_days", action: "send_email", delay: 30, unit: "days", channel: "email", nl: "Hi {{first_name}}, tijd voor je volgende behandeling bij {{salon_name}}?", en: "Hi {{first_name}}, ready for your next treatment at {{salon_name}}?" },
  { key: "missed_booking", group: "Bookings", name: "Gemiste boeking reminder", trigger: "inactive_60_days", action: "send_email", delay: 0, unit: "instant", channel: "email", nl: "Hi {{first_name}}, we hebben je al even niet gezien. Plan makkelijk je volgende afspraak.", en: "Hi {{first_name}}, we have not seen you for a while. Book your next visit easily." },
  { key: "inactive_60_days", group: "Retention", name: "We missen je 60 dagen", trigger: "inactive_60_days", action: "send_email", delay: 0, unit: "instant", channel: "email", nl: "Hi {{first_name}}, we missen je bij {{salon_name}}. Zullen we iets voor je inplannen?", en: "Hi {{first_name}}, we miss you at {{salon_name}}. Shall we book your next visit?" },
  { key: "winback_90_days", group: "Retention", name: "Win-back korting na 90 dagen", trigger: "inactive_90_days", action: "create_voucher", delay: 0, unit: "instant", channel: "email", nl: "Hi {{first_name}}, speciaal voor jou: een comeback voordeel bij {{salon_name}}.", en: "Hi {{first_name}}, a special comeback offer is waiting at {{salon_name}}." },
  { key: "birthday_voucher", group: "Retention", name: "Verjaardag voucher", trigger: "birthday", action: "create_voucher", delay: 0, unit: "instant", channel: "email", nl: "Gefeliciteerd {{first_name}}! Je verjaardagscadeau van {{salon_name}} staat klaar.", en: "Happy birthday {{first_name}}! Your gift from {{salon_name}} is ready." },
  { key: "loyalty_reward", group: "Retention", name: "Loyalty reward na X bezoeken", trigger: "visits_threshold", action: "add_loyalty_points", delay: 0, unit: "instant", channel: "email", nl: "Hi {{first_name}}, je hebt een loyaliteitsbeloning verdiend bij {{salon_name}}.", en: "Hi {{first_name}}, you earned a loyalty reward at {{salon_name}}." },
  { key: "no_show_followup", group: "No-show / Failed", name: "No-show follow-up", trigger: "no_show", action: "send_email", delay: 0, unit: "instant", channel: "email", nl: "Hi {{first_name}}, we hebben je gemist. Neem contact op om opnieuw te plannen.", en: "Hi {{first_name}}, we missed you. Contact us to reschedule." },
  { key: "payment_failed", group: "No-show / Failed", name: "Betaling mislukt reminder", trigger: "payment_failed", action: "send_email", delay: 0, unit: "instant", channel: "email", nl: "Hi {{first_name}}, je betaling is niet gelukt. Rond deze opnieuw af om je plek te behouden.", en: "Hi {{first_name}}, your payment failed. Please retry to keep your booking." },
  { key: "membership_payment_failed", group: "No-show / Failed", name: "Membership betaling mislukt", trigger: "membership_payment_failed", action: "send_email", delay: 0, unit: "instant", channel: "email", nl: "Hi {{first_name}}, je membership betaling is mislukt. Werk je betaling bij om actief te blijven.", en: "Hi {{first_name}}, your membership payment failed. Update your payment to stay active." },
  { key: "credits_almost_finished", group: "Memberships", name: "Credits bijna op", trigger: "credits_almost_finished", action: "send_email", delay: 0, unit: "instant", channel: "email", nl: "Hi {{first_name}}, je hebt nog {{credits_left}} credits binnen {{membership_name}}.", en: "Hi {{first_name}}, you have {{credits_left}} credits left in {{membership_name}}." },
  { key: "renewal_reminder", group: "Memberships", name: "Verlenging reminder", trigger: "renewal_reminder", action: "send_email", delay: 0, unit: "instant", channel: "email", nl: "Hi {{first_name}}, je membership bij {{salon_name}} wordt binnenkort verlengd.", en: "Hi {{first_name}}, your membership at {{salon_name}} renews soon." },
  { key: "trial_ending_soon", group: "Memberships", name: "Trial eindigt binnenkort", trigger: "trial_ending_soon", action: "send_email", delay: 0, unit: "instant", channel: "email", nl: "Hi {{first_name}}, je proefperiode eindigt binnenkort.", en: "Hi {{first_name}}, your trial ends soon." },
  { key: "cancel_winback", group: "Memberships", name: "Opzeg win-back aanbod", trigger: "cancel_winback", action: "send_email", delay: 7, unit: "days", channel: "email", nl: "Hi {{first_name}}, we willen je graag terug verwelkomen bij {{salon_name}}.", en: "Hi {{first_name}}, we would love to welcome you back at {{salon_name}}." },
  { key: "review_after_appointment", group: "Reviews", name: "Review vragen na afspraak", trigger: "ask_review_after_appointment", action: "send_email", delay: 1, unit: "days", channel: "email", nl: "Hi {{first_name}}, hoe was je behandeling bij {{salon_name}}?", en: "Hi {{first_name}}, how was your treatment at {{salon_name}}?" },
  { key: "google_review_5_star", group: "Reviews", name: "Google review na 5 sterren", trigger: "five_star_feedback", action: "send_email", delay: 0, unit: "instant", channel: "email", nl: "Dankjewel {{first_name}}! Wil je je ervaring ook delen via Google?", en: "Thank you {{first_name}}! Would you share your experience on Google too?" },
];

const TRIGGERS = ["appointment_booked", "appointment_completed", "appointment_cancelled", "no_show", "birthday", "new_customer", "inactive_60_days", "membership_created", "membership_cancelled", "payment_failed", "payment_succeeded"];
const ACTIONS = ["send_email", "send_sms", "send_whatsapp", "create_voucher", "add_loyalty_points", "internal_notification", "staff_task", "add_tag"];

export default function AutomatiseringenPage() {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const { hasAny } = useUserRole();
  const canManage = hasAny("eigenaar", "manager", "admin");
  const canDelete = hasAny("eigenaar");
  const [activeTab, setActiveTab] = useState("hub");
  const [rules, setRules] = useState<Rule[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", trigger_type: "inactive_60_days", action_type: "send_email", channel: "email", delay_value: 0, delay_unit: "instant", nl: "Hi {{first_name}}, ", en: "Hi {{first_name}}, " });

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [rulesRes, runsRes, logsRes, settingsRes] = await Promise.all([
      (supabase as any).from("automation_rules").select("*").order("created_at", { ascending: false }),
      (supabase as any).from("automation_runs").select("*").order("created_at", { ascending: false }).limit(200),
      (supabase as any).from("automation_logs").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("settings").select("*").eq("user_id", user.id).eq("is_demo", demoMode).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setRules(rulesRes.data || []);
    setRuns(runsRes.data || []);
    setLogs(logsRes.data || []);
    setSettings(settingsRes.data || null);
    setLoading(false);
  }, [user, demoMode]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const thisMonth = useMemo(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1), []);
  const stats = useMemo(() => {
    const monthlyRuns = runs.filter((r) => new Date(r.created_at) >= thisMonth);
    const today = new Date().toDateString();
    return {
      active: rules.filter((r) => r.is_active).length,
      sent: monthlyRuns.filter((r) => r.status === "sent").length,
      booked: monthlyRuns.filter((r) => Number(r.revenue_attributed || 0) > 0).length,
      revenue: monthlyRuns.reduce((sum, r) => sum + Number(r.revenue_attributed || 0), 0),
      upcoming: runs.filter((r) => r.status === "scheduled" && new Date(r.scheduled_for).toDateString() === today).length,
    };
  }, [rules, runs, thisMonth]);

  const addTemplate = async (template: typeof TEMPLATES[number]) => {
    if (!user || !canManage) return;
    const exists = rules.some((rule) => rule.template_key === template.key);
    if (exists) return;
    const { error } = await (supabase as any).from("automation_rules").insert({
      user_id: user.id,
      is_demo: demoMode,
      name: template.name,
      description: template.group,
      template_key: template.key,
      trigger_type: template.trigger,
      action_type: template.action,
      delay_value: template.delay,
      delay_unit: template.unit,
      channel: template.channel,
      message_templates: { nl: template.nl, en: template.en },
      provider_required: ["sms", "whatsapp"].includes(template.channel),
      is_active: true,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Automatisering geactiveerd");
    fetchData();
  };

  const addCustom = async () => {
    if (!user || !canManage) return;
    const { error } = await (supabase as any).from("automation_rules").insert({
      user_id: user.id,
      is_demo: demoMode,
      name: form.name || "Custom automation",
      trigger_type: form.trigger_type,
      action_type: form.action_type,
      channel: form.channel,
      delay_value: Number(form.delay_value || 0),
      delay_unit: form.delay_unit,
      message_templates: { nl: form.nl, en: form.en },
      conditions: {},
      provider_required: ["sms", "whatsapp"].includes(form.channel),
      is_active: true,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Automation opgeslagen");
    setShowBuilder(false);
    fetchData();
  };

  const toggleRule = async (rule: Rule) => {
    if (!canManage) return;
    await (supabase as any).from("automation_rules").update({ is_active: !rule.is_active }).eq("id", rule.id);
    toast.success(rule.is_active ? "Automation gepauzeerd" : "Automation actief");
    fetchData();
  };

  const deleteRule = async (id: string) => {
    if (!canDelete) return;
    await (supabase as any).from("automation_rules").delete().eq("id", id);
    toast.success("Automation verwijderd");
    fetchData();
  };

  const groupedTemplates = TEMPLATES.reduce<Record<string, typeof TEMPLATES>>((acc, template) => {
    acc[template.group] = [...(acc[template.group] || []), template];
    return acc;
  }, {});

  return (
    <AppLayout title="Automations" subtitle="Live omzet-automatiseringen voor boekingen, retention en memberships" actions={canManage && <Button variant="gradient" size="sm" onClick={() => setShowBuilder(true)}><Plus className="w-4 h-4" /> Nieuwe automation</Button>}>
      <ConfirmDialog open={!!confirmDeleteId} onOpenChange={(open) => !open && setConfirmDeleteId(null)} title="Automation verwijderen?" description="Deze automation en geplande runs worden verwijderd." confirmLabel="Verwijderen" destructive onConfirm={async () => { if (confirmDeleteId) await deleteRule(confirmDeleteId); }} />

      {showBuilder && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 backdrop-blur-sm p-3" onClick={() => setShowBuilder(false)}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-4 sm:p-6" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-5"><div><h2 className="text-lg font-semibold">Automation builder</h2><p className="text-sm text-muted-foreground">Maak een eigen regel met echte triggers en providerstatus.</p></div><Button variant="ghost" size="sm" onClick={() => setShowBuilder(false)}>Sluiten</Button></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 sm:col-span-2"><span className="text-xs font-medium text-muted-foreground">Naam</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm" placeholder="Bijv. We missen je 60 dagen" /></label>
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Trigger</span><select value={form.trigger_type} onChange={(e) => setForm({ ...form, trigger_type: e.target.value })} className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm">{TRIGGERS.map((trigger) => <option key={trigger} value={trigger}>{trigger}</option>)}</select></label>
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Actie</span><select value={form.action_type} onChange={(e) => setForm({ ...form, action_type: e.target.value })} className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm">{ACTIONS.map((action) => <option key={action} value={action}>{action}</option>)}</select></label>
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Kanaal</span><select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm"><option value="email">Email</option><option value="whatsapp">WhatsApp — provider required</option><option value="sms">SMS — provider required</option></select></label>
              <div className="grid grid-cols-2 gap-2"><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Delay</span><input type="number" min="0" value={form.delay_value} onChange={(e) => setForm({ ...form, delay_value: Number(e.target.value) })} className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm" /></label><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Eenheid</span><select value={form.delay_unit} onChange={(e) => setForm({ ...form, delay_unit: e.target.value })} className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm"><option value="instant">Direct</option><option value="hours">Uren</option><option value="days">Dagen</option></select></label></div>
              <label className="space-y-1 sm:col-span-2"><span className="text-xs font-medium text-muted-foreground">Bericht NL</span><textarea value={form.nl} onChange={(e) => setForm({ ...form, nl: e.target.value })} className="min-h-24 w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm" /></label>
              <label className="space-y-1 sm:col-span-2"><span className="text-xs font-medium text-muted-foreground">Bericht EN</span><textarea value={form.en} onChange={(e) => setForm({ ...form, en: e.target.value })} className="min-h-24 w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm" /></label>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Variabelen: {{first_name}}, {{last_name}}, {{salon_name}}, {{appointment_date}}, {{service_name}}, {{credits_left}}, {{membership_name}}, {{voucher_code}}</p>
            <div className="mt-5 flex gap-2"><Button variant="outline" className="flex-1" onClick={() => setShowBuilder(false)}>Annuleren</Button><Button variant="gradient" className="flex-1" onClick={addCustom}>Opslaan</Button></div>
          </div>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-2">
        {[['hub','Hub',Bot],['templates','Templates',Sparkles],['builder','Regels',Zap],['logs','Logs',FileText],['settings','Settings',Settings]].map(([key, label, Icon]: any) => <button key={key} onClick={() => setActiveTab(key)} className={cn("flex items-center gap-2 rounded-xl px-3 py-2 text-sm whitespace-nowrap transition-colors", activeTab === key ? "bg-primary text-primary-foreground" : "bg-secondary/50 text-muted-foreground hover:text-foreground")}><Icon className="h-4 w-4" />{label}</button>)}
      </div>

      {activeTab === "hub" && <div className="grid gap-4"><div className="grid grid-cols-2 lg:grid-cols-5 gap-3">{[["Actief", stats.active, CheckCircle2], ["Verstuurd", stats.sent, MessageCircle], ["Boekingen", stats.booked, CalendarClock], ["Omzet", formatEuro(stats.revenue), BarChart3], ["Vandaag", stats.upcoming, Clock]].map(([label, value, Icon]: any) => <Card key={label}><CardContent className="p-4"><Icon className="mb-3 h-5 w-5 text-primary" /><p className="text-xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></CardContent></Card>)}</div><Card><CardHeader><CardTitle className="text-base">Snel activeren</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{TEMPLATES.slice(0, 6).map((template) => { const exists = rules.some((rule) => rule.template_key === template.key); return <button key={template.key} disabled={!canManage || exists} onClick={() => addTemplate(template)} className={cn("rounded-xl border border-border p-3 text-left text-sm transition-colors", exists ? "bg-success/10 text-success" : "bg-secondary/20 hover:bg-secondary/50")}><span className="font-medium">{template.name}</span><span className="mt-1 block text-xs text-muted-foreground">{exists ? "Actief" : template.group}</span></button>; })}</CardContent></Card></div>}

      {activeTab === "templates" && <div className="grid gap-4">{Object.entries(groupedTemplates).map(([group, templates]) => <Card key={group}><CardHeader><CardTitle className="text-base">{group}</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">{templates.map((template) => { const exists = rules.some((rule) => rule.template_key === template.key); const providerMissing = ["sms", "whatsapp"].includes(template.channel) && !settings?.[template.channel === "whatsapp" ? "whatsapp_enabled" : "sms_enabled"]; return <button key={template.key} disabled={!canManage || exists} onClick={() => addTemplate(template)} className={cn("rounded-xl border border-border p-3 text-left transition-colors", exists ? "bg-success/10" : "bg-secondary/20 hover:bg-secondary/50")}><div className="flex items-start justify-between gap-2"><span className="text-sm font-medium">{template.name}</span>{exists && <span className="text-xs text-success">Actief</span>}</div><p className="mt-1 text-xs text-muted-foreground">{providerMissing ? "Provider vereist" : `${template.trigger} → ${template.action}`}</p></button>; })}</CardContent></Card>)}</div>}

      {activeTab === "builder" && <Card><CardHeader><CardTitle className="text-base">Actieve regels ({rules.filter((rule) => rule.is_active).length})</CardTitle></CardHeader><CardContent className="space-y-2">{loading ? <p className="py-8 text-center text-sm text-muted-foreground">Laden...</p> : rules.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nog geen automations. Activeer “We missen je 60 dagen” vanuit Templates.</p> : rules.map((rule) => <div key={rule.id} className="flex items-center gap-3 rounded-xl bg-secondary/25 p-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10"><Zap className="h-4 w-4 text-primary" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{rule.name || `${rule.trigger_type} → ${rule.action_type}`}</p><p className="text-xs text-muted-foreground">{rule.channel || "email"} · {rule.is_active ? "actief" : "gepauzeerd"}{["sms", "whatsapp"].includes(rule.channel || "") ? " · provider required" : ""}</p></div>{canManage && <button onClick={() => toggleRule(rule)} className="rounded-lg p-2 hover:bg-secondary">{rule.is_active ? <ToggleRight className="h-5 w-5 text-success" /> : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}</button>}{canDelete && <button onClick={() => setConfirmDeleteId(rule.id)} className="rounded-lg p-2 hover:bg-destructive/10"><Trash2 className="h-4 w-4 text-destructive" /></button>}</div>)}</CardContent></Card>}

      {activeTab === "logs" && <div className="grid gap-4"><div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{["sent", "scheduled", "failed", "skipped"].map((status) => <Card key={status}><CardContent className="p-4"><p className="text-xl font-semibold">{runs.filter((run) => run.status === status).length + logs.filter((log) => log.status === status).length}</p><p className="text-xs capitalize text-muted-foreground">{status}</p></CardContent></Card>)}</div><Card><CardHeader><CardTitle className="text-base">Automation logs</CardTitle></CardHeader><CardContent className="space-y-2">{logs.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nog geen logs.</p> : logs.map((log) => <div key={log.id} className="rounded-xl bg-secondary/25 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{log.message || log.event_type}</p><p className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString("nl-NL")}</p></div><span className={cn("rounded-full px-2 py-1 text-xs", log.status === "sent" ? "bg-success/10 text-success" : log.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-secondary text-muted-foreground")}>{log.status}</span></div></div>)}</CardContent></Card></div>}

      {activeTab === "settings" && <Card><CardHeader><CardTitle className="text-base">Provider status</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-secondary/25 p-4"><Bell className="mb-2 h-5 w-5 text-primary" /><p className="font-medium">Email</p><p className="text-sm text-muted-foreground">{settings?.email_enabled ? "Actief" : "Provider vereist"}</p></div><div className="rounded-xl bg-secondary/25 p-4"><MessageCircle className="mb-2 h-5 w-5 text-primary" /><p className="font-medium">WhatsApp</p><p className="text-sm text-muted-foreground">{settings?.whatsapp_enabled ? "Actief" : "Provider vereist"}</p></div><div className="rounded-xl bg-secondary/25 p-4"><ShieldAlert className="mb-2 h-5 w-5 text-primary" /><p className="font-medium">SMS</p><p className="text-sm text-muted-foreground">Provider vereist</p></div></CardContent></Card>}
    </AppLayout>
  );
}
