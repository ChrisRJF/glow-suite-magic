import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Plus } from "lucide-react";
import { toast } from "sonner";
import { useDossierAccess } from "@/hooks/useDossierAccess";

interface AlertRow {
  id: string;
  label: string;
  source_type: string;
  review_status: "unreviewed" | "reviewed" | "action_needed";
  created_at: string;
}

const STATUS_LABEL: Record<AlertRow["review_status"], string> = {
  unreviewed: "Nog te beoordelen",
  reviewed: "Beoordeeld",
  action_needed: "Actie nodig",
};

export function CustomerAlertsPanel({ customerId }: { customerId: string }) {
  const { canViewContent, loading } = useDossierAccess();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("customer_alerts")
      .select("id, label, source_type, review_status, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });
    setAlerts((data as AlertRow[]) || []);
  };

  useEffect(() => {
    if (!loading && canViewContent) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, canViewContent, customerId]);

  if (loading || !canViewContent) return null;

  const add = async () => {
    const label = newLabel.trim();
    if (!label) return;
    setBusy(true);
    const { data: tenant } = await supabase.rpc("current_tenant_id");
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("customer_alerts").insert({
      user_id: tenant as string,
      customer_id: customerId,
      source_type: "manual",
      label,
      created_by: userData?.user?.id ?? null,
    });
    setBusy(false);
    if (error) return toast.error("Toevoegen mislukt");
    setNewLabel("");
    load();
  };

  const setStatus = async (id: string, review_status: AlertRow["review_status"]) => {
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("customer_alerts")
      .update({ review_status, reviewed_by: userData?.user?.id ?? null, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error("Bijwerken mislukt");
    load();
  };

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <AlertTriangle className="h-4 w-4 text-amber-600" /> Aandachtspunten
      </h4>

      {alerts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Geen aandachtspunten.</p>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 ${a.review_status === "action_needed" ? "border-warning/30 bg-warning/5" : a.review_status === "unreviewed" ? "border-primary/20 bg-primary/5" : "border-border"}`}>
              <div>
                <p className="text-sm text-foreground">{a.label}</p>
                <p className="text-xs text-muted-foreground">
                  <span className={a.review_status === "action_needed" ? "font-medium text-warning" : ""}>{STATUS_LABEL[a.review_status]}</span>
                  {a.source_type === "form_answer" ? " · uit formulier" : " · handmatig"}
                </p>
              </div>
              {a.review_status === "unreviewed" && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setStatus(a.id, "reviewed")}>
                    Beoordeeld
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setStatus(a.id, "action_needed")}>
                    Actie nodig
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input placeholder="Aandachtspunt toevoegen" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
        <Button variant="outline" size="sm" disabled={busy} onClick={add}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Toevoegen
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Aandachtspunten zijn administratieve notities. GlowSuite stelt geen diagnose en geeft geen behandeladvies.
      </p>
    </div>
  );
}
