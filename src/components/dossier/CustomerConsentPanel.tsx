import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldOff, History } from "lucide-react";
import { toast } from "sonner";
import { useDossierAccess } from "@/hooks/useDossierAccess";

interface Props {
  customerId: string;
  onChanged?: () => void;
}

interface ConsentEvent {
  id: string;
  scope: string;
  event: string;
  occurred_at: string;
  source: string;
  version: number | null;
  note: string | null;
}

const SCOPES: { key: string; label: string; hint: string }[] = [
  { key: "marketing_general", label: "Foto's tonen op eigen kanalen", hint: "Website en social media van de salon" },
  { key: "advertising", label: "Foto's gebruiken in advertenties", hint: "Betaalde campagnes en advertenties" },
];

const STATUS_LABEL: Record<string, string> = {
  granted: "Gegeven",
  withdrawn: "Ingetrokken",
  not_given: "Niet gegeven",
};

const SOURCE_LABEL: Record<string, string> = {
  salon: "Vastgelegd in de salon",
  form: "Via ondertekend formulier",
  booking: "Bij het boeken",
  import: "Overgezet uit oud systeem",
};

export function CustomerConsentPanel({ customerId, onChanged }: Props) {
  const { canViewStatus, canViewContent, loading } = useDossierAccess();
  const [status, setStatus] = useState<Record<string, string>>({});
  const [mayManage, setMayManage] = useState(false);
  const [events, setEvents] = useState<ConsentEvent[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadStatus = async () => {
    const { data } = await supabase.functions.invoke("customer-consents", {
      body: { action: "status", customer_id: customerId },
    });
    const res = data as { status?: Record<string, string>; may_manage?: boolean } | null;
    setStatus(res?.status ?? {});
    setMayManage(res?.may_manage === true);
  };

  useEffect(() => {
    if (!loading && canViewStatus) loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, canViewStatus, customerId]);

  if (loading || !canViewStatus) return null;

  const change = async (scope: string, grant: boolean) => {
    setBusy(scope);
    const { data, error } = await supabase.functions.invoke("customer-consents", {
      body: { action: grant ? "grant" : "withdraw", customer_id: customerId, scope },
    });
    setBusy(null);
    if (error || (data as { error?: string })?.error) return toast.error("Wijzigen mislukt");
    toast.success(grant ? "Toestemming vastgelegd" : "Toestemming ingetrokken");
    await loadStatus();
    if (events) await loadHistory();
    onChanged?.();
  };

  const loadHistory = async () => {
    const { data } = await supabase.functions.invoke("customer-consents", {
      body: { action: "history", customer_id: customerId },
    });
    setEvents(((data as { events?: ConsentEvent[] })?.events ?? []) as ConsentEvent[]);
  };

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ShieldCheck className="h-4 w-4 text-primary" /> Toestemming voor foto's
      </h4>

      <div className="space-y-2">
        {SCOPES.map((s) => {
          const value = status[s.key] ?? "not_given";
          const granted = value === "granted";
          return (
            <div key={s.key} className="flex flex-col items-stretch gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.hint}</p>
                <p className="mt-1 text-xs font-medium text-foreground">{STATUS_LABEL[value]}</p>
              </div>
              {mayManage && (
                <Button
                  className="w-full whitespace-normal sm:w-auto"
                  size="sm"
                  variant={granted ? "outline" : "default"}
                  disabled={busy === s.key}
                  onClick={() => change(s.key, !granted)}
                >
                  {granted ? (
                    <>
                      <ShieldOff className="mr-1 h-3.5 w-3.5" /> Intrekken
                    </>
                  ) : (
                    "Toestemming vastleggen"
                  )}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {canViewContent && (
        <div className="px-0.5">
          <Button className="w-full justify-start whitespace-normal sm:w-auto" variant="ghost" size="sm" onClick={() => (events ? setEvents(null) : loadHistory())}>
            <History className="mr-1 h-3.5 w-3.5" />
            {events ? "Historie verbergen" : "Historie bekijken"}
          </Button>
          {events && (
            <div className="mt-2 space-y-1.5">
              {events.length === 0 && <p className="text-sm text-muted-foreground">Nog niets vastgelegd.</p>}
              {events.map((e) => (
                <div key={e.id} className="rounded-lg border border-border p-2 text-xs">
                  <p className="font-medium text-foreground">
                    {SCOPES.find((s) => s.key === e.scope)?.label ?? e.scope} ·{" "}
                    {e.event === "granted" ? "gegeven" : "ingetrokken"}
                  </p>
                  <p className="text-muted-foreground">
                    {new Date(e.occurred_at).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                    {SOURCE_LABEL[e.source] ?? e.source}
                    {e.version ? ` · versie ${e.version}` : ""}
                  </p>
                  {e.note && <p className="text-muted-foreground">{e.note}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
