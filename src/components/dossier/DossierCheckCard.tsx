import { CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { FORM_STATE_LABEL } from "@/hooks/useDossierStatus";
import { formatValidity, VALIDITY_CLASS } from "@/lib/formValidity";

interface FormReason {
  title: string;
  ok: boolean;
  state?: string | null;
  valid_until?: string | null;
}

interface Reasons {
  forms: FormReason[];
  treatment_record_required?: boolean;
  treatment_record_status?: string | null;
  before_photos?: number;
  after_photos?: number;
}

/**
 * P3 dossiercheck: één rustige checklist voor en na de behandeling,
 * met steeds één duidelijke volgende actie. Alleen presentatie,
 * gebaseerd op de bestaande dossierstatus.
 */
export function DossierCheckCard({ reasons }: { reasons: Reasons }) {
  const forms = reasons.forms ?? [];
  const recordRequired = Boolean(reasons.treatment_record_required);
  const recordDone = reasons.treatment_record_status === "completed";
  const beforeOk = (reasons.before_photos ?? 0) > 0;
  const afterOk = (reasons.after_photos ?? 0) > 0;

  const missingForm = forms.find((f) => !f.ok);
  const nextAction = missingForm
    ? `Formulier "${missingForm.title}" laten invullen`
    : recordRequired && !recordDone
      ? "Behandelverslag afronden"
      : null;

  const Row = ({ ok, label, extra }: { ok: boolean; label: string; extra?: React.ReactNode }) => (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {ok ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <Circle className="h-3 w-3" />}
      {label}
      {extra}
    </p>
  );

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">Voor de behandeling</p>
        {forms.length === 0 && <Row ok label="Geen formulieren nodig" />}
        {forms.map((f) => {
          const validity = f.ok ? formatValidity(f.valid_until ?? null) : null;
          return (
            <Row
              key={f.title}
              ok={f.ok}
              label={`${f.title} ${f.ok ? "ingevuld" : FORM_STATE_LABEL[(f.state as keyof typeof FORM_STATE_LABEL) ?? "missing"]}`}
              extra={validity ? <span className={VALIDITY_CLASS[validity.tone]}>· {validity.text}</span> : undefined}
            />
          );
        })}
        {beforeOk && <Row ok label="Voorfoto toegevoegd" />}
      </div>

      {(recordRequired || afterOk) && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Na de behandeling</p>
          {recordRequired && <Row ok={recordDone} label={`Behandelverslag ${recordDone ? "afgerond" : "nog niet afgerond"}`} />}
          {afterOk && <Row ok label="Nafoto toegevoegd" />}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <ArrowRight className="h-3 w-3 text-primary" />
        {nextAction ? `Volgende actie: ${nextAction}` : "Volgende actie: niets, dit dossier is compleet"}
      </p>
    </div>
  );
}
