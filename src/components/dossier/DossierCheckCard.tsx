import { CheckCircle2, Circle, AlertTriangle, ArrowRight } from "lucide-react";
import { buildPreparation, nextAction, type PreparationInput, type Signal } from "@/lib/dossierInsights";

interface Reasons {
  forms: { title: string; ok: boolean; state?: string | null; valid_until?: string | null }[];
  treatment_record_required?: boolean;
  treatment_record_status?: string | null;
  before_photos?: number;
  after_photos?: number;
  open_alerts?: number;
}

interface Props {
  reasons: Reasons;
  previousRecord?: boolean;
  appointmentCompleted?: boolean;
  aftercareAvailable?: boolean;
  journeyNeedsFollowUp?: boolean;
}

function Row({ signal }: { signal: Signal }) {
  const Icon = signal.tone === "ok" ? CheckCircle2 : signal.tone === "attention" ? AlertTriangle : Circle;
  const color = signal.tone === "ok" ? "text-emerald-600" : signal.tone === "attention" ? "text-amber-600" : "text-muted-foreground";
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className={`h-3 w-3 ${color}`} />
      {signal.label}
    </p>
  );
}

/**
 * P4 voorbereiding: administratieve signalen en één volgende actie.
 * Regelgebaseerd, geen medische beoordeling en geen automatische wijziging.
 */
export function DossierCheckCard({
  reasons,
  previousRecord = false,
  appointmentCompleted = false,
  aftercareAvailable = false,
  journeyNeedsFollowUp = false,
}: Props) {
  const input: PreparationInput = {
    forms: (reasons.forms ?? []).map((f) => ({ title: f.title, ok: f.ok, state: f.state ?? null })),
    treatmentRecordRequired: Boolean(reasons.treatment_record_required),
    treatmentRecordDone: reasons.treatment_record_status === "completed",
    beforePhotos: reasons.before_photos ?? 0,
    afterPhotos: reasons.after_photos ?? 0,
    openAlerts: reasons.open_alerts ?? 0,
    previousRecord,
    appointmentCompleted,
    aftercareAvailable,
    journeyNeedsFollowUp,
  };
  const signals = buildPreparation(input);
  const action = nextAction(input);

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <p className="text-xs font-medium text-foreground">Voorbereiding</p>
      <div className="space-y-1">
        {signals.map((s) => (
          <Row key={s.key} signal={s} />
        ))}
      </div>

      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <ArrowRight className="h-3 w-3 text-primary" />
        {action ? `Volgende actie: ${action.label}` : "Volgende actie: niets, dit dossier is compleet"}
      </p>
      <p className="text-[11px] text-muted-foreground">
        Administratieve controle. GlowSuite stelt geen diagnose en geeft geen behandeladvies.
      </p>
    </div>
  );
}
