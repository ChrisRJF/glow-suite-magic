import { useEffect, useState } from "react";
import { Archive, Download, LockKeyhole, RefreshCcw, ShieldAlert, Trash2, UserRoundX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

interface Props {
  customerId: string;
  onChanged?: () => void;
}

interface PrivacyState {
  capabilities: { export: boolean; archive: boolean; hold: boolean; pseudonymize: boolean; delete: boolean };
  legal_hold: { id: string; reason: string; created_at: string } | null;
  preflight: { blocked: boolean; blockers: { code: string; label: string }[]; counts: Record<string, number> };
  requests: { id: string; request_type: string; status: string; requested_at: string; export_expires_at: string | null }[];
}

type DangerousAction = "pseudonymize" | "delete";

export function CustomerPrivacyPanel({ customerId, onChanged }: Props) {
  const [state, setState] = useState<PrivacyState | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [dangerous, setDangerous] = useState<DangerousAction | null>(null);
  const [confirmation, setConfirmation] = useState("");

  const invoke = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("privacy-actions", { body: { customer_id: customerId, ...body } });
    if (error) throw error;
    if (data?.error) throw new Error(String(data.error));
    return data;
  };

  const load = async () => {
    try {
      const data = await invoke({ action: "state" });
      setState(data as PrivacyState);
    } catch {
      setState(null);
    }
  };

  useEffect(() => { load(); }, [customerId]);

  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    setLoading(true);
    try {
      const data = await invoke({ action, idempotency_key: `${action}:${customerId}:${Date.now()}`, ...extra });
      if (action === "export" && data.download_url) window.open(String(data.download_url), "_blank", "noopener,noreferrer");
      toast.success(action === "export" ? "Privacy-export is klaar" : "Privacyactie is verwerkt");
      await load();
      onChanged?.();
      return true;
    } catch (error) {
      const message = error instanceof Error && error.message === "blocked"
        ? "Deze actie is geblokkeerd. Bekijk eerst de openstaande verplichtingen."
        : "Privacyactie kon niet worden verwerkt";
      toast.error(message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  if (!state) return null;
  const archived = state.requests[0]?.request_type === "archive" && state.requests[0]?.status === "completed";
  const expected = dangerous === "delete" ? "VERWIJDER" : "PSEUDONIMISEER";

  return (
    <section className="space-y-3" aria-labelledby="privacy-heading">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h4 id="privacy-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldAlert className="h-4 w-4 text-primary" /> Privacy
        </h4>
        {state.legal_hold && <span className="rounded-md bg-warning/15 px-2 py-1 text-[11px] font-medium text-warning">Bewaarblokkade</span>}
      </div>

      {state.preflight.blocked && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-foreground">
          <p className="font-medium">Definitief verwijderen is nu geblokkeerd.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {state.preflight.blockers.map((blocker) => <li key={blocker.code}>{blocker.label}</li>)}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {state.capabilities.export && (
          <Button className="w-full whitespace-normal" variant="outline" size="sm" disabled={loading} onClick={() => run("export", { include_photos: false })}>
            <Download className="mr-1 h-3.5 w-3.5" /> Privacy-export
          </Button>
        )}
        {state.capabilities.archive && (
          <Button className="w-full whitespace-normal" variant="outline" size="sm" disabled={loading} onClick={() => run(archived ? "restore" : "archive")}>
            {archived ? <RefreshCcw className="mr-1 h-3.5 w-3.5" /> : <Archive className="mr-1 h-3.5 w-3.5" />}
            {archived ? "Herstellen" : "Archiveren"}
          </Button>
        )}
      </div>

      {state.capabilities.hold && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="flex items-center gap-2 text-xs font-medium"><LockKeyhole className="h-3.5 w-3.5" /> Bewaarblokkade</p>
          {state.legal_hold ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{state.legal_hold.reason}</p>
              <Button className="w-full whitespace-normal sm:w-auto" variant="outline" size="sm" disabled={loading} onClick={() => run("release_hold")}>Opheffen</Button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Korte zakelijke reden" className="min-h-16 w-full rounded-md border border-border bg-background px-3 py-2 text-xs" />
              <Button className="w-full whitespace-normal sm:w-auto" variant="outline" size="sm" disabled={loading || reason.trim().length < 3} onClick={() => run("hold", { reason }).then((ok) => ok && setReason(""))}>Instellen</Button>
            </div>
          )}
        </div>
      )}

      {(state.capabilities.pseudonymize || state.capabilities.delete) && (
        <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:flex-wrap">
          {state.capabilities.pseudonymize && (
            <Button className="w-full whitespace-normal sm:w-auto" variant="outline" size="sm" disabled={loading || !!state.legal_hold} onClick={() => { setConfirmation(""); setDangerous("pseudonymize"); }}>
              <UserRoundX className="mr-1 h-3.5 w-3.5" /> Pseudonimiseren
            </Button>
          )}
          {state.capabilities.delete && (
            <Button className="w-full whitespace-normal sm:w-auto" variant="destructive" size="sm" disabled={loading || state.preflight.blocked} onClick={() => { setConfirmation(""); setDangerous("delete"); }}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Definitief verwijderen
            </Button>
          )}
        </div>
      )}

      <AlertDialog open={dangerous !== null} onOpenChange={(open) => !open && setDangerous(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dangerous === "delete" ? "Klantgegevens definitief verwijderen?" : "Klant pseudonimiseren?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {dangerous === "delete"
                ? "GlowSuite controleert vlak voor uitvoering opnieuw op financiële verplichtingen en een bewaarbelemmering. Het klantrecord wordt als laatste verwijderd."
                : "Contactgegevens worden verwijderd en alle toekomstige communicatie stopt. Ondertekende documenten blijven ongewijzigd. Dit is geen volledige anonimisering."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="text-xs font-medium text-foreground">
            Typ {expected} om te bevestigen
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              disabled={loading || confirmation !== expected}
              className={dangerous === "delete" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
              onClick={(event) => {
                event.preventDefault();
                if (!dangerous) return;
                run(dangerous, { confirmation }).then((ok) => { if (ok) setDangerous(null); });
              }}
            >
              Bevestigen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}