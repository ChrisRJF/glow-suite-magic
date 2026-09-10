import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FileText, Send, ShieldCheck, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useDossierAccess } from "@/hooks/useDossierAccess";

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
  rendered_snapshot: { fields?: { key: string; label: string; value: unknown }[]; title?: string } | null;
  signer_name: string | null;
  signed_at: string | null;
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
        .select("id, request_id, rendered_snapshot, signer_name, signed_at, document_hash, submitted_at")
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
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" /> Dossier
        </h4>
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
                    </p>
                  </div>
                  {canViewContent && submission && (
                    <Button variant="ghost" size="sm" onClick={() => setOpenSubmission(openSubmission === r.id ? null : r.id)}>
                      {openSubmission === r.id ? "Verberg" : "Bekijk"}
                    </Button>
                  )}
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
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" /> Ondertekend door {submission.signer_name}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground break-all">Documentcode: {submission.document_hash.slice(0, 16)}</p>
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
    </div>
  );
}
