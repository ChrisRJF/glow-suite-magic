import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { formatEuro } from "@/lib/data";
import { Zap, Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AutomationRule {
  id: string;
  trigger_type: string;
  action_type: string;
  is_active: boolean;
  config: Record<string, any>;
  last_triggered_at: string | null;
}

const TRIGGERS = [
  { value: "nieuwe_klant", label: "Nieuwe klant", icon: "👤" },
  { value: "afspraak_geboekt", label: "Afspraak geboekt", icon: "📅" },
  { value: "no_show_risico", label: "No-show risico", icon: "⚠️" },
  { value: "lege_plekken", label: "Lege plekken in agenda", icon: "📉" },
  { value: "betaling_mislukt", label: "Betaling mislukt", icon: "❌" },
];

const ACTIONS = [
  { value: "stuur_email", label: "Stuur e-mail (gesimuleerd)", icon: "📧" },
  { value: "stuur_whatsapp", label: "Stuur WhatsApp bericht", icon: "💬" },
  { value: "stuur_betaalverzoek", label: "Stuur betaalverzoek", icon: "💳" },
  { value: "activeer_korting", label: "Activeer korting", icon: "🏷️" },
  { value: "markeer_risico", label: "Markeer klant als risico", icon: "🚩" },
  { value: "markeer_vip", label: "Markeer klant als VIP", icon: "⭐" },
];

const PRESETS = [
  { trigger: "nieuwe_klant", action: "activeer_korting", label: "Nieuwe klant → Stuur welkomskorting" },
  { trigger: "no_show_risico", action: "stuur_betaalverzoek", label: "No-show risico → Verplicht aanbetaling" },
  { trigger: "lege_plekken", action: "activeer_korting", label: "Lege plekken → Activeer last-minute korting" },
  { trigger: "betaling_mislukt", action: "stuur_betaalverzoek", label: "Betaling mislukt → Stuur opnieuw betaalverzoek" },
  { trigger: "afspraak_geboekt", action: "stuur_whatsapp", label: "Afspraak geboekt → Stuur bevestiging via WhatsApp" },
];

export default function AutomatiseringenPage() {
  const { user } = useAuth();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ trigger_type: TRIGGERS[0].value, action_type: ACTIONS[0].value });

  const fetchRules = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("automation_rules").select("*").order("created_at", { ascending: false });
    if (data) setRules(data as AutomationRule[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleAdd = async () => {
    if (!user) return;
    const { error } = await supabase.from("automation_rules").insert({
      user_id: user.id,
      trigger_type: form.trigger_type,
      action_type: form.action_type,
    } as any);
    if (error) { toast.error("Fout: " + error.message); return; }
    toast.success("Automatisering toegevoegd");
    setShowAdd(false);
    fetchRules();
  };

  const handlePreset = async (preset: typeof PRESETS[0]) => {
    if (!user) return;
    const { error } = await supabase.from("automation_rules").insert({
      user_id: user.id,
      trigger_type: preset.trigger,
      action_type: preset.action,
    } as any);
    if (error) { toast.error("Fout: " + error.message); return; }
    toast.success("Automatisering geactiveerd");
    fetchRules();
  };

  const toggleRule = async (rule: AutomationRule) => {
    await supabase.from("automation_rules").update({ is_active: !rule.is_active } as any).eq("id", rule.id);
    toast.success(rule.is_active ? "Automatisering gepauzeerd" : "Automatisering geactiveerd");
    fetchRules();
  };

  const deleteRule = async (id: string) => {
    await supabase.from("automation_rules").delete().eq("id", id);
    toast.success("Automatisering verwijderd");
    fetchRules();
  };

  const getTrigger = (v: string) => TRIGGERS.find(t => t.value === v);
  const getAction = (v: string) => ACTIONS.find(a => a.value === v);

  return (
    <AppLayout title="Automatiseringen" subtitle="IF → THEN regels voor je salon"
      actions={<Button variant="gradient" size="sm" onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Nieuwe regel</Button>}>

      {showAdd && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="glass-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Nieuwe automatisering</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground font-medium">ALS (trigger)</label>
                <select value={form.trigger_type} onChange={e => setForm({ ...form, trigger_type: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium">DAN (actie)</label>
                <select value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.icon} {a.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Annuleren</Button>
              <Button variant="gradient" className="flex-1" onClick={handleAdd}>Opslaan</Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6">
        {/* Presets */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" /> Snelle automatiseringen
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PRESETS.map((preset, i) => {
              const exists = rules.some(r => r.trigger_type === preset.trigger && r.action_type === preset.action);
              return (
                <button key={i} onClick={() => !exists && handlePreset(preset)} disabled={exists}
                  className={cn("p-3 rounded-xl text-left text-sm transition-colors",
                    exists ? "bg-success/10 border border-success/20 cursor-default" : "bg-secondary/30 hover:bg-secondary/50 border border-transparent")}>
                  <span className="font-medium">{preset.label}</span>
                  {exists && <span className="block text-[11px] text-success mt-0.5">✓ Actief</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Rules */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4">Actieve regels ({rules.filter(r => r.is_active).length})</h3>
          <div className="space-y-2">
            {loading ? <p className="text-sm text-muted-foreground text-center py-6">Laden...</p> :
             rules.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">Nog geen automatiseringen. Klik op een snelle automatisering of maak een eigen regel.</p> :
             rules.map(rule => {
              const trigger = getTrigger(rule.trigger_type);
              const action = getAction(rule.action_type);
              return (
                <div key={rule.id} className={cn("flex items-center gap-3 p-3 rounded-xl transition-colors",
                  rule.is_active ? "bg-secondary/30" : "bg-secondary/10 opacity-60")}>
                  <span className="text-lg flex-shrink-0">{trigger?.icon || "❓"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{trigger?.label || rule.trigger_type} → {action?.label || rule.action_type}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {rule.is_active ? "Actief" : "Gepauzeerd"}
                      {rule.last_triggered_at && ` · Laatst: ${new Date(rule.last_triggered_at).toLocaleDateString("nl-NL")}`}
                    </p>
                  </div>
                  <button onClick={() => toggleRule(rule)} className="p-1.5 rounded-lg hover:bg-secondary">
                    {rule.is_active ? <ToggleRight className="w-5 h-5 text-success" /> : <ToggleLeft className="w-5 h-5 text-muted-foreground" />}
                  </button>
                  <button onClick={() => deleteRule(rule.id)} className="p-1.5 rounded-lg hover:bg-destructive/20">
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
