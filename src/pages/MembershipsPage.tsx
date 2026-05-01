import { AppLayout } from "@/components/AppLayout";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCustomerMemberships, useCustomers, useMembershipPlans, useSettings } from "@/hooks/useSupabaseData";
import { usePayments } from "@/hooks/usePayments";
import { useCrud } from "@/hooks/useCrud";
import { exportCSV } from "@/lib/exportUtils";
import { formatEuro } from "@/lib/data";
import { cn } from "@/lib/utils";
import { PaymentMethodLogo } from "@/components/PaymentMethodLogo";
import { supabase } from "@/integrations/supabase/client";
import { Archive, Check, Crown, Euro, EyeOff, Gift, Loader2, Pause, Play, Plus, RefreshCw, ShieldAlert, Trash2, TrendingUp, UserPlus, Users, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type MembershipFeatureKey = "white_label_signup" | "credits_system" | "self_cancel" | "pause_allowed" | "trials" | "waitlist" | "referrals" | "auto_renew" | "churn_analytics" | "member_portal";
type MembershipFeatures = Record<MembershipFeatureKey, boolean>;

const intervalLabels: Record<string, string> = { monthly: "Maandelijks", quarterly: "Kwartaal", yearly: "Jaarlijks" };
const statusLabels: Record<string, string> = { active: "Actief", paused: "Gepauzeerd", cancelled: "Opgezegd", expired: "Verlopen", payment_issue: "Betalingsprobleem" };
const statusClasses: Record<string, string> = {
  active: "bg-success/10 text-success border-success/20",
  paused: "bg-warning/10 text-warning border-warning/20",
  cancelled: "bg-muted text-muted-foreground border-border",
  expired: "bg-muted text-muted-foreground border-border",
  payment_issue: "bg-destructive/10 text-destructive border-destructive/20",
};
const paymentMethods = [
  { id: "ideal", label: "iDEAL | Wero" },
  { id: "creditcard", label: "Creditcard" },
  { id: "bancontact", label: "Bancontact" },
];
const defaultFeatures: MembershipFeatures = {
  white_label_signup: true,
  credits_system: true,
  self_cancel: false,
  pause_allowed: true,
  trials: false,
  waitlist: false,
  referrals: false,
  auto_renew: true,
  churn_analytics: true,
  member_portal: true,
};
const featureLabels: { key: MembershipFeatureKey; label: string; description: string }[] = [
  { key: "white_label_signup", label: "White-label aanmelden", description: "Openbare aanmeldpagina zonder GlowSuite branding." },
  { key: "member_portal", label: "Ledenportaal", description: "Klanten kunnen abonnementen online bekijken en starten." },
  { key: "credits_system", label: "Creditsysteem", description: "Inbegrepen behandelingen, credits en resets tonen." },
  { key: "auto_renew", label: "Automatisch verlengen", description: "Terugkerende incasso's en volgende betaaldatum tonen." },
  { key: "pause_allowed", label: "Pauzeren toegestaan", description: "Salon kan leden tijdelijk pauzeren of heractiveren." },
  { key: "self_cancel", label: "Zelf opzeggen", description: "Opzegacties worden zichtbaar wanneer dit actief is." },
  { key: "churn_analytics", label: "Churn analytics", description: "Churn, win-back en retentie-rapportage tonen." },
  { key: "trials", label: "Trials", description: "Proefperiodes tonen zodra beschikbaar voor deze salon." },
  { key: "waitlist", label: "Wachtlijst", description: "Wachtlijst-flow tonen zodra beschikbaar voor abonnementen." },
  { key: "referrals", label: "Referrals", description: "Referral-acties tonen zodra beschikbaar voor leden." },
];

function defaultBenefits(name: string) {
  return name.toLowerCase().includes("vip")
    ? ["Voorrang bij boeken", "Leden only acties", "Exclusieve voordelen"]
    : ["Vaste maandelijkse voordelen", "Automatische betaling", "Ledenkorting"];
}

function getMembershipFeatures(settings: any): MembershipFeatures {
  const branding = settings?.whitelabel_branding && typeof settings.whitelabel_branding === "object" ? settings.whitelabel_branding : {};
  return { ...defaultFeatures, ...(branding.membership_features || {}) };
}

export default function MembershipsPage() {
  const { data: plans, loading: plansLoading, refetch: refetchPlans } = useMembershipPlans();
  const { data: memberships, loading: membershipsLoading, refetch: refetchMemberships } = useCustomerMemberships();
  const { data: customers } = useCustomers();
  const { data: payments } = usePayments();
  const { data: settingsRows, refetch: refetchSettings } = useSettings();
  const planCrud = useCrud("membership_plans");
  const memberCrud = useCrud("customer_memberships");
  const [activeTab, setActiveTab] = useState<"overzicht" | "plannen" | "leden" | "functies" | "rapportage">("overzicht");
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [deletePlan, setDeletePlan] = useState<any | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({ name: "", price: 49, description: "", benefits: "", billing_interval: "monthly", included_treatments: 1, discount_percentage: 10, priority_booking: true, credits_reset: true, is_active: true });
  const [memberForm, setMemberForm] = useState({ customer_id: "", membership_plan_id: "", method: "ideal" });

  const settings = settingsRows[0] as any | undefined;
  const features = getMembershipFeatures(settings);
  const salonSlug = settings?.public_slug || (settings?.salon_name || "mijn-salon").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const publicUrl = `${window.location.origin}/abonnements/${salonSlug}`;
  const activeMembers = memberships.filter((m: any) => m.status === "active");
  const issueMembers = memberships.filter((m: any) => m.status === "payment_issue");
  const cancelledMembers = memberships.filter((m: any) => ["cancelled", "expired"].includes(m.status));

  const enriched = useMemo(() => memberships.map((abonnement: any) => {
    const plan = plans.find((p: any) => p.id === abonnement.membership_plan_id);
    const customer = customers.find((c: any) => c.id === abonnement.customer_id);
    return { ...abonnement, plan, customer };
  }), [customers, memberships, plans]);

  const stats = useMemo(() => {
    const mrr = enriched.filter((m: any) => m.status === "active").reduce((sum: number, m: any) => {
      const price = Number(m.plan?.price || 0);
      const interval = m.plan?.billing_interval || "monthly";
      return sum + (interval === "yearly" ? price / 12 : interval === "quarterly" ? price / 3 : price);
    }, 0);
    const membershipPayments = (payments as any[]).filter((p) => p.payment_type === "membership" && p.status === "paid");
    const topPlan = plans.map((plan: any) => ({ plan, count: activeMembers.filter((m: any) => m.membership_plan_id === plan.id).length })).sort((a, b) => b.count - a.count)[0];
    const churnRate = memberships.length ? Math.round((cancelledMembers.length / memberships.length) * 100) : 0;
    return { mrr, expected: features.auto_renew ? mrr : 0, paidRevenue: membershipPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0), topPlan, churnRate };
  }, [activeMembers, cancelledMembers.length, features.auto_renew, memberships.length, payments, plans, enriched]);

  const resetPlanForm = () => {
    setEditingPlanId(null);
    setPlanForm({ name: "", price: 49, description: "", benefits: "", billing_interval: "monthly", included_treatments: 1, discount_percentage: 10, priority_booking: true, credits_reset: true, is_active: true });
  };

  const openEditPlan = (plan: any) => {
    setEditingPlanId(plan.id);
    setPlanForm({
      name: plan.name || "",
      price: Number(plan.price || 0),
      description: plan.description || "",
      benefits: Array.isArray(plan.benefits) ? plan.benefits.join("\n") : "",
      billing_interval: plan.billing_interval || "monthly",
      included_treatments: Number(plan.included_treatments || 0),
      discount_percentage: Number(plan.discount_percentage || 0),
      priority_booking: Boolean(plan.priority_booking),
      credits_reset: plan.credits_reset !== false,
      is_active: plan.is_active !== false,
    });
    setShowPlanForm(true);
  };

  const savePlan = async () => {
    if (!planForm.name.trim()) { toast.error("Naam is verplicht"); return; }
    const payload = {
      ...planForm,
      benefits: planForm.benefits.split("\n").map((item) => item.trim()).filter(Boolean).length ? planForm.benefits.split("\n").map((item) => item.trim()).filter(Boolean) : defaultBenefits(planForm.name),
      price: Number(planForm.price || 0),
      included_treatments: Number(planForm.included_treatments || 0),
      discount_percentage: Number(planForm.discount_percentage || 0),
    };
    const result = editingPlanId ? await planCrud.update(editingPlanId, payload) : await planCrud.insert(payload);
    if (result) {
      toast.success(editingPlanId ? "Abonnement bijgewerkt" : "Abonnement aangemaakt");
      setShowPlanForm(false);
      resetPlanForm();
      refetchPlans();
    }
  };

  const addManualMember = async () => {
    const plan = plans.find((p: any) => p.id === memberForm.membership_plan_id);
    if (!memberForm.customer_id || !plan) { toast.error("Kies een klant en abonnement"); return; }
    const result = await memberCrud.insert({
      customer_id: memberForm.customer_id,
      membership_plan_id: plan.id,
      status: "active",
      credits_available: Number(plan.included_treatments || 0),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      last_payment_status: "manual",
      metadata: { source: "manual" },
    });
    if (result) {
      toast.success("Lid handmatig toegevoegd");
      setShowMemberForm(false);
      setMemberForm({ customer_id: "", membership_plan_id: "", method: "ideal" });
      refetchMemberships();
    }
  };

  const startCheckout = async () => {
    const plan = plans.find((p: any) => p.id === memberForm.membership_plan_id);
    if (!memberForm.customer_id || !plan) { toast.error("Kies een klant en abonnement"); return; }
    const customer = customers.find((c: any) => c.id === memberForm.customer_id);
    const created = await memberCrud.insert({
      customer_id: memberForm.customer_id,
      membership_plan_id: plan.id,
      status: "payment_issue",
      credits_available: Number(plan.included_treatments || 0),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      last_payment_status: "open",
      metadata: { source: "salon_checkout" },
    });
    if (!created) return;
    setBusyId(created.id);
    const { data, error } = await supabase.functions.invoke("create-payment", { body: { amount: Number(plan.price || 0), payment_type: "membership", membership_id: created.id, customer_id: customer?.id, method: memberForm.method, redirect_url: window.location.href } });
    setBusyId(null);
    if (error) { toast.error((error as any)?.message || "Checkout kon niet worden gestart"); return; }
    if (data?.demo) {
      toast.success("Demo uitgevoerd — er is niets echt verstuurd of ingepland.", {
        description: data?.message || "Demo betaling gesimuleerd",
      });
      refetchMemberships();
      return;
    }
    if (!data?.checkoutUrl) { toast.error(data?.error || "Checkout kon niet worden gestart"); return; }
    window.location.href = data.checkoutUrl;
  };

  const updateMember = async (id: string, data: Record<string, any>, message: string) => {
    setBusyId(id);
    const result = await memberCrud.update(id, data);
    setBusyId(null);
    if (result) { toast.success(message); refetchMemberships(); }
  };

  const activeMembersForPlan = (planId: string) => activeMembers.filter((member: any) => member.membership_plan_id === planId).length;

  const updatePlanStatus = async (planId: string, isActive: boolean, message: string) => {
    setBusyId(planId);
    const result = await planCrud.update(planId, { is_active: isActive });
    setBusyId(null);
    if (result) { toast.success(message); refetchPlans(); }
  };

  const removePlan = async () => {
    if (!deletePlan) return;
    if (activeMembersForPlan(deletePlan.id) > 0) { toast.error("Verwijderen kan alleen zonder actieve leden"); return; }
    setBusyId(deletePlan.id);
    const removed = await planCrud.remove(deletePlan.id);
    setBusyId(null);
    if (removed) { toast.success("Abonnement verwijderd"); setDeletePlan(null); setShowPlanForm(false); resetPlanForm(); refetchPlans(); }
  };

  const resetCredits = async () => {
    if (!features.credits_system) return;
    setBusyId("reset");
    const { error } = await supabase.rpc("reset_due_membership_credits" as any, { _user_id: (settings as any)?.user_id });
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Credits bijgewerkt");
    refetchMemberships();
  };

  const updateFeature = async (key: MembershipFeatureKey, enabled: boolean) => {
    if (!settings?.id) { toast.error("Instellingen zijn nog niet geladen"); return; }
    const branding = settings.whitelabel_branding && typeof settings.whitelabel_branding === "object" ? settings.whitelabel_branding : {};
    const nextFeatures = { ...features, [key]: enabled };
    const { error } = await supabase.from("settings").update({ whitelabel_branding: { ...branding, membership_features: nextFeatures } }).eq("id", settings.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Abonnementsfunctie bijgewerkt");
    refetchSettings();
  };

  const exportLeden = (type: "active" | "churn" | "revenue" | "open") => {
    const rows = enriched.filter((m: any) => type === "active" ? m.status === "active" : type === "churn" ? ["cancelled", "expired"].includes(m.status) : type === "open" ? m.last_payment_status !== "paid" && m.status !== "active" : true)
      .map((m: any) => [m.customer?.name || "Onbekend", m.plan?.name || "Abonnement", statusLabels[m.status] || m.status, formatEuro(Number(m.plan?.price || 0)), m.next_payment_at ? new Date(m.next_payment_at).toLocaleDateString("nl-NL") : "Niet gepland"]);
    exportCSV(["Klant", "Abonnement", "Status", "Prijs", "Volgende incasso"], rows, `abonnements-${type}.csv`);
    toast.success("CSV export gestart");
  };

  const loading = plansLoading || membershipsLoading;
  const statCards = [
    { label: "MRR", value: formatEuro(stats.mrr), icon: Euro, show: true },
    { label: "Actieve leden", value: String(activeMembers.length), icon: Users, show: true },
    { label: "Verwacht komende maand", value: formatEuro(stats.expected), icon: TrendingUp, show: features.auto_renew },
    { label: "Betalingsproblemen", value: String(issueMembers.length), icon: ShieldAlert, show: true },
  ].filter((item) => item.show);

  return (
    <AppLayout title="Abonnementen" subtitle="Terugkerende omzet, ledenvoordelen en betaalstatussen." actions={<Button variant="gradient" size="sm" onClick={() => { resetPlanForm(); setShowPlanForm(true); }}><Plus className="w-4 h-4" /> Nieuw abonnement</Button>}>
      <ConfirmDialog
        open={!!deletePlan}
        onOpenChange={(open) => !open && setDeletePlan(null)}
        title="Abonnement verwijderen?"
        description="Dit kan niet ongedaan worden gemaakt. Verwijderen kan alleen wanneer er geen actieve leden op dit abonnement zitten."
        confirmLabel="Verwijderen"
        destructive
        onConfirm={removePlan}
      />

      {showPlanForm && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowPlanForm(false)}>
          <div className="glass-card p-5 sm:p-6 w-full max-w-4xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5"><h3 className="text-lg font-semibold">{editingPlanId ? "Abonnement bewerken" : "Nieuw abonnement"}</h3><p className="text-sm text-muted-foreground">Heldere prijzen, credits en ledenvoordelen voor je aanmeldpagina.</p></div>
            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <div className="space-y-5">
                <div className="premium-panel space-y-4"><h4 className="text-sm font-semibold">Basis</h4><div className="space-y-1.5"><Label>Abonnement naam</Label><Input value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} placeholder="Bijv. Glow Premium" /></div><div className="space-y-1.5"><Label>Beschrijving</Label><textarea value={planForm.description} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} placeholder="Korte beschrijving voor klanten" className="form-input h-auto min-h-[78px] py-2.5" /></div></div>
                <div className="premium-panel space-y-4"><h4 className="text-sm font-semibold">Prijs</h4><div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div className="space-y-1.5"><Label>Prijs per maand (€)</Label><Input type="number" min="0" value={planForm.price} onChange={(e) => setPlanForm({ ...planForm, price: Number(e.target.value) })} /><p className="text-xs text-muted-foreground">Maandelijks terugkerend betaalbedrag.</p></div><div className="space-y-1.5"><Label>Facturatie</Label><select value={planForm.billing_interval} onChange={(e) => setPlanForm({ ...planForm, billing_interval: e.target.value })} className="form-input"><option value="monthly">Maandelijks</option><option value="quarterly">Kwartaal</option><option value="yearly">Jaarlijks</option></select><p className="text-xs text-muted-foreground">Hoe vaak dit abonnement wordt gefactureerd.</p></div></div></div>
                <div className="premium-panel space-y-4"><h4 className="text-sm font-semibold">Voordelen</h4><div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{features.credits_system && <div className="space-y-1.5"><Label>Credits per maand</Label><Input type="number" min="0" value={planForm.included_treatments} onChange={(e) => setPlanForm({ ...planForm, included_treatments: Number(e.target.value) })} /><p className="text-xs text-muted-foreground">Hoeveel behandelingen/uses leden per maand krijgen.</p></div>}<div className="space-y-1.5"><Label>Ledenkorting (%)</Label><Input type="number" min="0" max="100" value={planForm.discount_percentage} onChange={(e) => setPlanForm({ ...planForm, discount_percentage: Number(e.target.value) })} /><p className="text-xs text-muted-foreground">Korting voor extra services/producten.</p></div></div><div className="space-y-1.5"><Label>Voordelenlijst</Label><textarea value={planForm.benefits} onChange={(e) => setPlanForm({ ...planForm, benefits: e.target.value })} placeholder="Voordelen, één per regel" className="form-input h-auto min-h-[96px] py-2.5" /></div></div>
                <div className="premium-panel space-y-3"><h4 className="text-sm font-semibold">Beheer</h4><label className="premium-row justify-between text-sm"><span>Voorrang bij boeken</span><Switch checked={planForm.priority_booking} onCheckedChange={(checked) => setPlanForm({ ...planForm, priority_booking: checked })} /></label>{features.credits_system && <label className="premium-row justify-between text-sm"><span>Credits maandelijks resetten</span><Switch checked={planForm.credits_reset} onCheckedChange={(checked) => setPlanForm({ ...planForm, credits_reset: checked })} /></label>}<label className="premium-row justify-between text-sm"><span>Verkoop actief op signup pagina</span><Switch checked={planForm.is_active} onCheckedChange={(checked) => setPlanForm({ ...planForm, is_active: checked })} /></label></div>
              </div>
              <aside className="space-y-4"><div className="premium-panel"><p className="text-xs font-medium text-muted-foreground mb-2">Live preview</p><h4 className="text-xl font-bold">{planForm.name || "Abonnement Name"}</h4><p className="text-sm text-muted-foreground mt-1">{planForm.description || "Beschrijving verschijnt hier."}</p><div className="flex items-baseline gap-1 mt-5"><span className="text-3xl font-bold">{formatEuro(Number(planForm.price || 0))}</span><span className="text-sm text-muted-foreground">/ maand</span></div><div className="grid grid-cols-3 gap-2 mt-5 text-center text-xs"><div className="rounded-xl bg-secondary/40 p-2"><b>{planForm.included_treatments || 0}</b><br />credits</div><div className="rounded-xl bg-secondary/40 p-2"><b>{planForm.discount_percentage || 0}%</b><br />korting</div><div className="rounded-xl bg-secondary/40 p-2"><b>{planForm.priority_booking ? "Ja" : "Nee"}</b><br />voorrang</div></div></div>{editingPlanId && <div className="premium-panel space-y-3"><h4 className="text-sm font-semibold">Abonnement acties</h4><Button variant="outline" size="sm" className="w-full justify-start" onClick={() => updatePlanStatus(editingPlanId, false, "Abonnement gearchiveerd")} disabled={busyId === editingPlanId}><Archive className="w-4 h-4" /> Abonnement archiveren</Button><Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setPlanForm({ ...planForm, is_active: false })}><EyeOff className="w-4 h-4" /> Verkoop pauzeren</Button><Button variant="destructive" size="sm" className="w-full justify-start" disabled={activeMembersForPlan(editingPlanId) > 0 || busyId === editingPlanId} onClick={() => setDeletePlan(plans.find((p: any) => p.id === editingPlanId))}><Trash2 className="w-4 h-4" /> Abonnement verwijderen</Button>{activeMembersForPlan(editingPlanId) > 0 && <p className="text-xs text-muted-foreground">Verwijderen kan pas bij 0 actieve leden.</p>}</div>}</aside>
            </div>
            <div className="flex gap-2 mt-5"><Button variant="outline" className="flex-1" onClick={() => setShowPlanForm(false)}>Annuleren</Button><Button variant="gradient" className="flex-1" onClick={savePlan}>Opslaan</Button></div>
          </div>
        </div>
      )}

      {showMemberForm && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-3 sm:p-4" onClick={() => setShowMemberForm(false)}>
          <div className="glass-card p-5 sm:p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Lid toevoegen</h3>
            <div className="space-y-3">
              <select value={memberForm.customer_id} onChange={(e) => setMemberForm({ ...memberForm, customer_id: e.target.value })} className="w-full px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm"><option value="">Kies klant</option>{customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <select value={memberForm.membership_plan_id} onChange={(e) => setMemberForm({ ...memberForm, membership_plan_id: e.target.value })} className="w-full px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm"><option value="">Kies abonnement</option>{plans.filter((p: any) => p.is_active).map((p: any) => <option key={p.id} value={p.id}>{p.name} · {formatEuro(Number(p.price || 0))}</option>)}</select>
              <div className="grid grid-cols-1 gap-2">{paymentMethods.map((method) => <button key={method.id} type="button" onClick={() => setMemberForm({ ...memberForm, method: method.id })} className={cn("min-h-12 rounded-xl border px-3 text-left text-sm font-medium transition-all flex items-center justify-between gap-3", memberForm.method === method.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary/40 hover:bg-secondary/60")}><span>{method.label}</span><PaymentMethodLogo method={method.id} className="h-6 max-w-24" /></button>)}</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-5"><Button variant="outline" onClick={addManualMember}>Handmatig actief</Button><Button variant="gradient" onClick={startCheckout} disabled={!!busyId}>{busyId ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Eerste betaling</Button></div>
          </div>
        </div>
      )}

      <div className="grid gap-5 sm:gap-6">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {[
            ["overzicht", "Overzicht"],
            ["plannen", "Abonnementen"],
            ["leden", "Leden"],
            ["functies", "Functies"],
            ["rapportage", "Rapportage"],
          ].map(([key, label]) => <Button key={key} variant={activeTab === key ? "secondary" : "ghost"} size="sm" className="shrink-0" onClick={() => setActiveTab(key as any)}>{label}</Button>)}
        </div>

        {activeTab === "overzicht" && (
          <div className="grid gap-5 sm:gap-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {statCards.map((stat) => <div key={stat.label} className="stat-card"><stat.icon className="w-5 h-5 text-primary mb-3" /><p className="text-2xl font-bold tabular-nums">{stat.value}</p><p className="text-xs text-muted-foreground">{stat.label}</p></div>)}
            </div>
            {features.churn_analytics && <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="glass-card p-5"><p className="text-xs text-muted-foreground mb-1">Top retention abonnement</p><p className="text-lg font-semibold">{stats.topPlan?.plan?.name || "Nog geen data"}</p><p className="text-sm text-muted-foreground">{stats.topPlan?.count || 0} actieve leden</p></div>
              <div className="glass-card p-5"><p className="text-xs text-muted-foreground mb-1">Churn</p><p className="text-lg font-semibold">{stats.churnRate}%</p><p className="text-sm text-muted-foreground">{cancelledMembers.length} opgezegd/verlopen</p></div>
              <div className="glass-card p-5"><p className="text-xs text-muted-foreground mb-1">Win-back</p><p className="text-lg font-semibold">{cancelledMembers.length}</p><p className="text-sm text-muted-foreground">Klanten om terug te winnen</p></div>
            </div>}
            {features.white_label_signup && features.member_portal && <div className="glass-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div><p className="font-semibold">White-label aanmeldpagina</p><p className="text-xs text-muted-foreground break-all">{publicUrl}</p></div>
              <div className="flex flex-col sm:flex-row gap-2"><Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(publicUrl).then(() => toast.success("Link gekopieerd"))}>Link kopiëren</Button><Button variant="outline" size="sm" onClick={() => window.open(publicUrl, "_blank")}>Preview</Button></div>
            </div>}
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="gradient" size="sm" onClick={() => setShowMemberForm(true)}><UserPlus className="w-4 h-4" /> Lid toevoegen</Button>
              {features.credits_system && <Button variant="outline" size="sm" onClick={resetCredits} disabled={busyId === "reset"}>{busyId === "reset" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Credits resetten</Button>}
            </div>
          </div>
        )}

        {activeTab === "plannen" && <section>
          <h2 className="text-lg font-semibold mb-4">Abonnement types</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {loading ? [1,2,3].map((i) => <div key={i} className="glass-card p-6 h-56 animate-pulse" />) : plans.length === 0 ? <div className="glass-card p-6 md:col-span-3 text-center text-sm text-muted-foreground">Nog geen abonnements aangemaakt. Maak je eerste abonnement aan.</div> : plans.map((plan: any) => (
              <div key={plan.id} className={cn("glass-card p-6 relative", !plan.is_active && "opacity-60")}>
                <div className="flex items-start justify-between gap-2 mb-3"><h3 className="text-lg font-bold">{plan.name}</h3><Badge variant="outline">{plan.is_active ? "Actief" : "Inactief"}</Badge></div>
                <p className="text-sm text-muted-foreground min-h-[40px]">{plan.description || "Geen beschrijving ingesteld"}</p>
                <div className="flex items-baseline gap-1 my-4"><span className="text-3xl font-bold">{formatEuro(Number(plan.price || 0))}</span><span className="text-sm text-muted-foreground">/{intervalLabels[plan.billing_interval] || "periode"}</span></div>
                <ul className="space-y-2 mb-5">{(Array.isArray(plan.benefits) ? plan.benefits : []).slice(0, 5).map((benefit: string) => <li key={benefit} className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 text-primary mt-0.5" />{benefit}</li>)}</ul>
                <div className={cn("grid gap-2 text-center text-xs mb-4", features.credits_system ? "grid-cols-3" : "grid-cols-2")}>{features.credits_system && <div className="rounded-lg bg-secondary/40 p-2"><b>{plan.included_treatments || 0}</b><br />credits</div>}<div className="rounded-lg bg-secondary/40 p-2"><b>{plan.discount_percentage || 0}%</b><br />korting</div><div className="rounded-lg bg-secondary/40 p-2"><b>{plan.priority_booking ? "Ja" : "Nee"}</b><br />voorrang</div></div>
                <Button variant="outline" className="w-full" onClick={() => openEditPlan(plan)}>Beheren</Button>
              </div>
            ))}
          </div>
        </section>}

        {activeTab === "leden" && <section className="glass-card p-5">
          <div className="flex items-center justify-between gap-3 mb-4"><h2 className="text-lg font-semibold">Ledenbeheer</h2><Badge variant="secondary">{enriched.length} leden</Badge></div>
          <div className="space-y-2">
            {loading ? <p className="text-sm text-muted-foreground text-center py-6">Leden laden...</p> : enriched.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">Nog geen leden. Voeg handmatig een lid toe{features.white_label_signup && features.member_portal ? " of deel de aanmeldpagina" : ""}.</p> : enriched.map((member: any) => (
              <div key={member.id} className="p-4 rounded-xl bg-secondary/30 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium truncate">{member.customer?.name || "Onbekende klant"}</p><span className={cn("px-2 py-0.5 rounded-full border text-[11px] font-medium", statusClasses[member.status] || statusClasses.expired)}>{statusLabels[member.status] || member.status}</span>{member.plan?.priority_booking && <Crown className="w-4 h-4 text-primary" />}</div><p className="text-xs text-muted-foreground">{member.plan?.name || "Abonnement"}{features.credits_system ? ` · ${member.credits_available || 0} credits beschikbaar` : ""}{features.auto_renew ? ` · volgende incasso ${member.next_payment_at ? new Date(member.next_payment_at).toLocaleDateString("nl-NL") : "niet gepland"}` : ""}</p></div>
                <div className="flex flex-col sm:flex-row gap-2">{features.pause_allowed && <Button variant="outline" size="sm" onClick={() => updateMember(member.id, { status: member.status === "paused" ? "active" : "paused", paused_at: member.status === "paused" ? null : new Date().toISOString() }, member.status === "paused" ? "Lid heractiveerd" : "Lid gepauzeerd")} disabled={busyId === member.id}>{member.status === "paused" ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}{member.status === "paused" ? "Heractiveer" : "Pauzeer"}</Button>}{features.credits_system && <Button variant="outline" size="sm" onClick={() => updateMember(member.id, { credits_available: Number(member.credits_available || 0) + 1 }, "Credit toegevoegd")} disabled={busyId === member.id}><Gift className="w-3.5 h-3.5" /> Credit</Button>}{features.self_cancel && <Button variant="outline" size="sm" onClick={() => updateMember(member.id, { status: "cancelled", cancel_at_period_end: true, cancelled_at: new Date().toISOString() }, "Lid opgezegd per periode") } disabled={busyId === member.id}><XCircle className="w-3.5 h-3.5" /> Stop</Button>}</div>
              </div>
            ))}
          </div>
        </section>}

        {activeTab === "functies" && <section className="glass-card p-5">
          <div className="mb-4"><h2 className="text-lg font-semibold">Abonnement functies per salon</h2><p className="text-sm text-muted-foreground">Zet alleen functies aan die deze salon echt gebruikt.</p></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {featureLabels.map((feature) => <div key={feature.key} className="rounded-xl bg-secondary/30 p-4 flex items-center justify-between gap-4"><div><p className="font-medium text-sm">{feature.label}</p><p className="text-xs text-muted-foreground mt-1">{feature.description}</p></div><Switch checked={features[feature.key]} onCheckedChange={(checked) => updateFeature(feature.key, checked)} /></div>)}
          </div>
        </section>}

        {activeTab === "rapportage" && <section className="glass-card p-5">
          <div className="mb-4"><h2 className="text-lg font-semibold">Rapportage</h2><p className="text-sm text-muted-foreground">CSV exports op basis van echte abonnementdata.</p></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <Button variant="outline" size="sm" onClick={() => exportLeden("active")}>Actieve leden CSV</Button>
            {features.churn_analytics && <Button variant="outline" size="sm" onClick={() => exportLeden("churn")}>Churn CSV</Button>}
            <Button variant="outline" size="sm" onClick={() => exportLeden("revenue")}>Omzet abonnementen CSV</Button>
            {features.auto_renew && <Button variant="outline" size="sm" onClick={() => exportLeden("open")}>Open incasso's CSV</Button>}
          </div>
        </section>}
      </div>
    </AppLayout>
  );
}
