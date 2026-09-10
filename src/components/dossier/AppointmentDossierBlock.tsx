import { CustomerDossierPanel } from "./CustomerDossierPanel";
import { TreatmentRecordPanel } from "./TreatmentRecordPanel";
import { ClinicalMediaPanel } from "./ClinicalMediaPanel";
import { DossierStatusBadge } from "./DossierStatusBadge";
import { useDossierStatus, DOSSIER_STATUS_LABEL } from "@/hooks/useDossierStatus";
import { useDossierAccess } from "@/hooks/useDossierAccess";
import { CheckCircle2, Circle } from "lucide-react";

interface Props {
  customerId: string;
  appointmentId: string | null;
  serviceId?: string | null;
}

/** Everything a treatment room needs for one appointment, in one calm block. */
export function AppointmentDossierBlock({ customerId, appointmentId, serviceId }: Props) {
  const { canViewStatus, canViewContent, loading } = useDossierAccess();
  const { statuses, refresh } = useDossierStatus(appointmentId ? [appointmentId] : []);
  if (loading || !canViewStatus || !customerId) return null;

  const entry = appointmentId ? statuses[appointmentId] : undefined;
  const reasons = entry?.reasons;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground">Dossier</h4>
        {entry && <DossierStatusBadge status={entry.status} />}
      </div>

      {reasons && (
        <div className="space-y-1">
          {reasons.forms.map((f) => (
            <p key={f.title} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {f.ok ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <Circle className="h-3 w-3" />}
              {f.title} {f.ok ? "ingevuld" : "ontbreekt"}
            </p>
          ))}
          {reasons.treatment_record_required && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {reasons.treatment_record_status === "completed" ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              ) : (
                <Circle className="h-3 w-3" />
              )}
              Behandelverslag {reasons.treatment_record_status === "completed" ? "afgerond" : "nog niet afgerond"}
            </p>
          )}
          {reasons.before_photos > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Voorfoto toegevoegd
            </p>
          )}
          {!entry && <p className="text-xs text-muted-foreground">{DOSSIER_STATUS_LABEL.af_te_ronden}</p>}
        </div>
      )}

      <CustomerDossierPanel customerId={customerId} appointmentId={appointmentId} compact />

      {canViewContent && appointmentId && (
        <>
          <TreatmentRecordPanel customerId={customerId} appointmentId={appointmentId} serviceId={serviceId} onChanged={refresh} />
          <ClinicalMediaPanel customerId={customerId} appointmentId={appointmentId} onChanged={refresh} />
        </>
      )}
    </div>
  );
}
