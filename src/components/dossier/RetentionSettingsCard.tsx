import { useEffect, useState } from "react";
import { CalendarClock, Loader2, PlayCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Policy {
  id: string;
  category: string;
  retention_months: number | null;
  action: "none" | "pseudonymize" | "delete";
  enabled: boolean;
  review_status: string;
  policy_version: number;
  dry_run_summary: Record<string, unknown> | null;
  dry_run_at: string | null;
}

const categories = [
  { id: "customer_profile", label: "Klantprofielen" },
  { id: "clinical_media", label: "Klinische foto's" },
  { id: "generated_exports", label: "Gegenereerde exports" },
] as const;

export function RetentionSettingsCard() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const call = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("privacy-actions", { body });
    if (error || data?.error) throw new Error(String(data?.error || error?.message));
    return data;
  };
  const load = async () => {
    try {
      const data = await call({ action: "retention_list" });
      setAllowed(data.may_manage === true);
      setPolicies(data.policies || []);
    } catch {
      setAllowed(false);
    }
  };
  useEffect(() => { load(); }, []);
  if (!allowed) return null;

  const policy = (category: string) => policies.find((item) => item.category === category);
  const saveDraft = async (category: string, months: number, action: Policy["action"]) => {
    setBusy(category);
    try {
      await call({ action: "retention_save", category, retention_months: months, retention_action: action });
      toast.success("Concept opgeslagen. Een nieuwe dry-run is vereist.");
      await load();
    } catch { toast.error("Bewaarbeleid kon niet worden opgeslagen"); }
    finally { setBusy(null); }
  };
  const dryRun = async (category: string) => {
    setBusy(category);
    try { await call({ action: "retention_dry_run", category }); toast.success("Dry-run afgerond zonder wijzigingen"); await load(); }
    catch { toast.error("Dry-run mislukt"); }
    finally { setBusy(null); }
  };
  const activate = async (category: string, version: number) => {
    setBusy(category);
    try { await call({ action: "retention_activate", category, policy_version: version, confirmation: "ACTIVEER" }); toast.success("Bewaarbeleid geactiveerd"); await load(); }
    catch { toast.error("Activeren mislukt. Voer eerst een nieuwe dry-run uit."); }
    finally { setBusy(null); }
  };

  return (
    <div className="glass-card p-6">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><CalendarClock className="h-4 w-4 text-primary" /> Privacy en bewaarbeleid</h3>
      <p className="mb-5 text-xs text-muted-foreground">Beleid staat standaard uit. Wijzigingen vereisen altijd een nieuwe controle en bevestiging.</p>
      <div className="space-y-4">
        {categories.map(({ id, label }) => {
          const item = policy(id);
          const months = item?.retention_months || 84;
          const action = item?.action || "none";
          return (
            <div key={id} className="space-y-3 border-b border-border pb-4 last:border-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-sm font-medium">{label}</p><p className="text-[11px] text-muted-foreground">Versie {item?.policy_version || 1} · {item?.enabled ? "Actief" : "Uit"}</p></div>
                {item?.enabled && <span className="flex items-center gap-1 text-[11px] font-medium text-success"><ShieldCheck className="h-3.5 w-3.5" /> Actief</span>}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-xs text-muted-foreground">Bewaren in maanden<input type="number" min={1} max={1200} defaultValue={months} id={`months-${id}`} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /></label>
                <label className="text-xs text-muted-foreground">Actie<select defaultValue={action} id={`action-${id}`} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"><option value="none">Geen automatische actie</option><option value="pseudonymize">Pseudonimiseren</option><option value="delete">Verwijderen</option></select></label>
              </div>
              {item?.dry_run_summary && <p className="text-xs text-muted-foreground">Controle: {Number(item.dry_run_summary.customers || 0)} klanten, {Number(item.dry_run_summary.documents || 0)} documenten, {Number(item.dry_run_summary.legal_holds_skipped || 0)} bewaarbelemmeringen overgeslagen.</p>}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={busy === id} onClick={() => {
                  const monthInput = document.getElementById(`months-${id}`) as HTMLInputElement | null;
                  const actionInput = document.getElementById(`action-${id}`) as HTMLSelectElement | null;
                  saveDraft(id, Number(monthInput?.value || months), (actionInput?.value || action) as Policy["action"]);
                }}>Concept opslaan</Button>
                <Button variant="outline" size="sm" disabled={busy === id || !item} onClick={() => dryRun(id)}><PlayCircle className="mr-1 h-3.5 w-3.5" /> Dry-run</Button>
                <Button size="sm" disabled={busy === id || item?.review_status !== "dry_run_ready"} onClick={() => item && activate(id, item.policy_version)}>
                  {busy === id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null} Activeren
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}