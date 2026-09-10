import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FileText, Send, ShieldCheck, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useDossierAccess } from "@/hooks/useDossierAccess";
import { CustomerAlertsPanel } from "./CustomerAlertsPanel";
import { CustomerTimeline } from "./CustomerTimeline";
import { CustomerConsentPanel } from "./CustomerConsentPanel";
import { DocumentExportDialog } from "./DocumentExportDialog";
import { CustomerPrivacyPanel } from "./CustomerPrivacyPanel";
import { JourneyPanel } from "./JourneyPanel";

interface Props {
  customerId: string;
  appointmentId?: string | null;
  compact?: boolean;
}

interface RequestRow {
  id: string;
  status: string;
  sent_at: string | null;
  completed_at: string | null;
  template_id: string;
  appointment_id: string | null;
}

interface SubmissionRow {
  id: string;
  request_id: string;
  rendered_snapshot: { fields?: { key: string; label: string; value: unknown }[]; title?: string; version?: number } | null;
  signer_name: string | null;
  signed_at: string | null;
  signature_data: string | null;
  document_hash: string;
  submitted_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Klaargezet",
  sent: "Verstuurd",
  opened: "Geopend",
  completed: "Ingevuld",
  expired: "Verlopen",
  cancelled: "Ingetrokken",
};

export function CustomerDossierPanel({ customerId, appointmentId = null, compact = false }: Props) {
  const { canViewStatus, canViewContent, canSend, loading: accessLoading } = useDossierAccess();
  const [templates, setTemplates] = useState<{ id: string; title: string; current_version: number }[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [openSubmission, setOpenSubmission] = useState<string | null>(null);

  const load = async () => {
    const [t, r] = await Promise.all([
      supabase.from("form_templates").select("id, title, current_version").eq("is_active", true).gt("current_version", 0),
      supabase.from("form_requests").select("id, status, sent_at, completed_at, template_id, appointment_id").eq("customer_id", customerId).order("created_at", { ascending: false }),
    ]);
    setTemplates((t.data as { id: string; title: string; current_version: number }[]) || []);
    setRequests((r.data as RequestRow[]) || []);
    if (canViewContent) {
      const { data } = await supabase
        .from("form_submissions")
        .select("id, request_id, rendered_snapshot, signer_name, signed_at, signature_data, document_hash, submitted_at")
        .eq("customer_id", customerId);
      setSubmissions((data as unknown as SubmissionRow[]) || []);
    }
  };

  useEffect(() => {
    if (!accessLoading && canViewStatus) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessLoading, canViewStatus, customerId]);

  if (accessLoading || !canViewStatus) return null;

  const visibleRequests = compact ? requests.filter((r) => r.appointment_id === appointmentId) : requests;

  /** Marks a template as "must be filled in again", without touching history. */
  const markReissue = async (templateId: string) => {
    const { data: tenant } = await supabase.rpc("current_tenant_id");
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("form_reissue_flags").upsert(
      {
        user_id: tenant as string,
        customer_id: customerId,
        template_id: templateId,
        required_after: new Date().toISOString(),
        created_by: userData?.user?.id ?? null,
      },
      { onConflict: "user_id,customer_id,template_id" },
    );
    if (error) return toast.error("Instellen mislukt");
    toast.success("Dit formulier wordt bij de volgende afspraak opnieuw gevraagd.");
    load();
  };

  const send = async (templateId: string) => {
    setSending(templateId);
    const { data, error } = await supabase.functions.invoke("customer-forms", {
      body: { action: "send", customer_id: customerId, template_id: templateId, appointment_id: appointmentId },
    });
    setSending(null);
    if (error) return toast.error("Versturen mislukt");
    const res = data as { duplicate?: boolean; delivery?: { ok?: boolean } };
    if (res?.duplicate) toast.info("Er staat al een openstaand formulier voor deze klant.");
    else if (res?.delivery?.ok === false) toast.warning("Formulier klaargezet, maar het bericht kon niet worden bezorgd.");
    else toast.success("Formulier verstuurd");
    load();
  };

  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> Dossier
          </h4>
          {canViewContent && (
            <DocumentExportDialog
              customerId={customerId}
              scope="full_dossier"
              triggerLabel="Dossier exporteren"
              triggerVariant="outline"
            />
          )}
        </div>
      )}
      {compact && canViewContent && appointmentId && (
        <div className="flex justify-end">
          <DocumentExportDialog
            customerId={customerId}
            appointmentId={appointmentId}
            scope="appointment_bundle"
            triggerLabel="Bundel exporteren"
          />
        </div>
      )}

      {visibleRequests.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nog geen formulieren verstuurd.</p>
      ) : (
        <div className="space-y-2">
          {visibleRequests.map((r) => {
            const template = templates.find((t) => t.id === r.template_id);
            const submission = submissions.find((s) => s.request_id === r.id);
            return (
              <div key={r.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{template?.title || submission?.rendered_snapshot?.title || "Formulier"}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      {r.status === "completed" ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <Clock className="h-3 w-3" />}
                      {STATUS_LABEL[r.status] || r.status}
                      {submission?.signed_at ? " en ondertekend" : ""}
                    </p>
                    {submission && (
                      <p className="text-xs text-muted-foreground">
                        {new Date(submission.submitted_at).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}
                        {submission.rendered_snapshot?.version ? ` · versie ${submission.rendered_snapshot.version}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {canSend && r.status === "completed" && !compact && (
                      <Button variant="ghost" size="sm" onClick={() => markReissue(r.template_id)}>
                        Opnieuw laten invullen
                      </Button>
                    )}
                    {canViewContent && submission && (
                      <Button variant="ghost" size="sm" onClick={() => setOpenSubmission(openSubmission === r.id ? null : r.id)}>
                        {openSubmission === r.id ? "Verberg" : "Bekijk"}
                      </Button>
                    )}
                    {canViewContent && submission && (
                      <DocumentExportDialog
                        customerId={customerId}
                        appointmentId={r.appointment_id}
                        scope="form"
                        sourceId={submission.id}
                        triggerLabel="PDF"
                      />
                    )}
                  </div>
                </div>

                {canViewContent && submission && openSubmission === r.id && (
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    {(submission.rendered_snapshot?.fields || []).map((f) => (
                      <div key={f.key} className="text-sm">
                        <span className="text-muted-foreground">{f.label}: </span>
                        <span className="text-foreground">
                          {typeof f.value === "boolean" ? (f.value ? "Ja" : "Nee") : f.value === null || f.value === "" ? "-" : String(f.value)}
                        </span>
                      </div>
                    ))}
                    {submission.signer_name && (
                      <div className="space-y-1 pt-1">
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3" /> Ondertekend door {submission.signer_name}
                          {submission.signed_at
                            ? ` op ${new Date(submission.signed_at).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}`
                            : ""}
                        </p>
                        {submission.signature_data && (
                          <img
                            src={submission.signature_data}
                            alt={`Handtekening van ${submission.signer_name}`}
                            className="h-16 rounded-lg border border-border bg-background"
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canSend && templates.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {templates.map((t) => (
            <Button key={t.id} variant="outline" size="sm" disabled={sending === t.id} onClick={() => send(t.id)}>
              <Send className="h-3.5 w-3.5 mr-1" />
              {sending === t.id ? "Versturen..." : t.title}
            </Button>
          ))}
        </div>
      )}

      {!compact && (
        <div className="space-y-5 border-t border-border pt-4">
          <JourneyPanel customerId={customerId} />
          <CustomerConsentPanel customerId={customerId} />
          <CustomerPrivacyPanel customerId={customerId} onChanged={load} />
          <CustomerAlertsPanel customerId={customerId} />
          <CustomerTimeline customerId={customerId} />
        </div>
      )}
    </div>
  );
}
