import { CustomerDossierPanel } from "./CustomerDossierPanel";
import { TreatmentRecordPanel } from "./TreatmentRecordPanel";
import { ClinicalMediaPanel } from "./ClinicalMediaPanel";
import { DossierStatusBadge } from "./DossierStatusBadge";
import { DossierCheckCard } from "./DossierCheckCard";
import { AppointmentAlertBanner } from "./AppointmentAlertBanner";
import { useDossierStatus, DOSSIER_STATUS_LABEL } from "@/hooks/useDossierStatus";
import { useDossierAccess } from "@/hooks/useDossierAccess";
import { useDossierOverview } from "@/hooks/useDossierOverview";
import { AiSummaryButton } from "./AiSummaryButton";

interface Props {
  customerId: string;
  appointmentId: string | null;
  serviceId?: string | null;
  appointmentStatus?: string | null;
}

/** Everything a treatment room needs for one appointment, in one calm block. */
export function AppointmentDossierBlock({ customerId, appointmentId, serviceId, appointmentStatus }: Props) {
  const { canViewStatus, canViewContent, loading } = useDossierAccess();
  const { statuses, refresh } = useDossierStatus(appointmentId ? [appointmentId] : []);
  const overview = useDossierOverview(customerId);
  if (loading || !canViewStatus || !customerId) return null;

  const entry = appointmentId ? statuses[appointmentId] : undefined;
  const reasons = entry?.reasons;
  const isCancelled = (appointmentStatus || "").toLowerCase() === "cancelled";
  const appointmentCompleted = (appointmentStatus || "").toLowerCase() === "completed";
  const previousRecord = overview.records.some((r) => r.status === "completed" && r.appointment_id !== appointmentId);
  const aftercareAvailable = Boolean(
    overview.services.find((s) => s.id === serviceId)?.aftercare_text?.trim(),
  );
  const current = overview.appointments.find((a) => a.id === appointmentId);
  const journeyNeedsFollowUp = Boolean(
    current?.journey_id &&
      !overview.appointments.some(
        (a) => a.journey_id === current.journey_id && a.id !== appointmentId && new Date(a.appointment_date) > new Date(),
      ),
  );

  return (
    <div className="space-y-4">
      <AppointmentAlertBanner
        customerId={customerId}
        canViewContent={canViewContent}
        openAlerts={reasons?.open_alerts ?? 0}
      />

      {isCancelled && (
        <p className="rounded-xl border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          Afspraak geannuleerd. Automatische formulieren en herinneringen zijn gestopt.
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground">Dossier</h4>
        {entry && <DossierStatusBadge status={entry.status} />}
      </div>

      {reasons ? (
        <DossierCheckCard
          reasons={reasons as never}
          previousRecord={previousRecord}
          appointmentCompleted={appointmentCompleted}
          aftercareAvailable={aftercareAvailable}
          journeyNeedsFollowUp={journeyNeedsFollowUp}
        />
      ) : (
        <p className="text-xs text-muted-foreground">{DOSSIER_STATUS_LABEL.af_te_ronden}</p>
      )}

      {canViewContent && (
        <AiSummaryButton
          label="AI-voorbereiding maken"
          action="appointment_prep"
          customerId={customerId}
          appointmentId={appointmentId}
        />
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
