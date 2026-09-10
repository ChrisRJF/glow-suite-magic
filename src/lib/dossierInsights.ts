/**
 * P4 rule-based clinic signals.
 *
 * Administrative only: these helpers describe what is missing in the file,
 * never whether a treatment is safe, advisable or medically indicated.
 * No AI, no interpretation of answers, no writes.
 */

export type SignalTone = "ok" | "attention" | "todo";

export interface Signal {
  key: string;
  tone: SignalTone;
  label: string;
}

export interface NextAction {
  key: string;
  label: string;
}

export interface PreparationInput {
  forms: { title: string; ok: boolean; state?: string | null }[];
  treatmentRecordRequired: boolean;
  treatmentRecordDone: boolean;
  beforePhotos: number;
  afterPhotos: number;
  openAlerts: number;
  /** A completed record exists for an earlier appointment of this customer. */
  previousRecord: boolean;
  appointmentCompleted: boolean;
  /** The booked service has aftercare text the customer can read in the portal. */
  aftercareAvailable: boolean;
  /** The customer belongs to a journey without a next planned session. */
  journeyNeedsFollowUp?: boolean;
}

const FORM_STATE_TEXT: Record<string, string> = {
  missing: "ontbreekt",
  expired: "verlopen",
  version_outdated: "nieuwe versie nodig",
  reissue_required: "opnieuw invullen",
};

/** Objective checklist for one appointment, in reading order. */
export function buildPreparation(input: PreparationInput): Signal[] {
  const signals: Signal[] = [];

  if (input.forms.length === 0) {
    signals.push({ key: "forms-none", tone: "ok", label: "Geen formulieren nodig" });
  }
  for (const f of input.forms) {
    signals.push({
      key: `form-${f.title}`,
      tone: f.ok ? "ok" : "todo",
      label: `${f.title} ${f.ok ? "in orde" : FORM_STATE_TEXT[f.state ?? "missing"] ?? "ontbreekt"}`,
    });
  }

  if (input.openAlerts > 0) {
    signals.push({
      key: "alerts",
      tone: "attention",
      label: input.openAlerts === 1 ? "Aandachtspunt aanwezig" : `${input.openAlerts} aandachtspunten aanwezig`,
    });
  }

  signals.push({
    key: "previous-record",
    tone: input.previousRecord ? "ok" : "todo",
    label: input.previousRecord ? "Vorig behandelverslag aanwezig" : "Nog geen eerder behandelverslag",
  });

  signals.push({
    key: "before-photo",
    tone: input.beforePhotos > 0 ? "ok" : "todo",
    label: input.beforePhotos > 0 ? "Voorfoto toegevoegd" : "Voorfoto ontbreekt",
  });

  if (input.treatmentRecordRequired) {
    signals.push({
      key: "record",
      tone: input.treatmentRecordDone ? "ok" : "todo",
      label: input.treatmentRecordDone ? "Behandelverslag afgerond" : "Behandelverslag nog niet afgerond",
    });
  }

  if (input.appointmentCompleted) {
    signals.push({
      key: "after-photo",
      tone: input.afterPhotos > 0 ? "ok" : "todo",
      label: input.afterPhotos > 0 ? "Controlefoto toegevoegd" : "Controlefoto ontbreekt",
    });
    signals.push({
      key: "aftercare",
      tone: input.aftercareAvailable ? "ok" : "todo",
      label: input.aftercareAvailable ? "Nazorg staat klaar voor de klant" : "Nazorg nog niet gedeeld",
    });
  }

  return signals;
}

/** At most one primary recommendation, in fixed priority order. */
export function nextAction(input: PreparationInput): NextAction | null {
  const missingForm = input.forms.find((f) => !f.ok);
  if (missingForm) {
    return {
      key: "form",
      label:
        missingForm.state === "expired" || missingForm.state === "reissue_required"
          ? `Formulier "${missingForm.title}" opnieuw laten invullen`
          : `Formulier "${missingForm.title}" versturen`,
    };
  }
  if (input.treatmentRecordRequired && !input.treatmentRecordDone) {
    return { key: "record", label: "Behandelverslag afronden" };
  }
  if (input.appointmentCompleted && input.afterPhotos === 0) {
    return { key: "photo", label: "Controlefoto toevoegen" };
  }
  if (input.appointmentCompleted && !input.aftercareAvailable) {
    return { key: "aftercare", label: "Nazorg delen" };
  }
  if (input.journeyNeedsFollowUp) {
    return { key: "journey", label: "Controle-afspraak plannen" };
  }
  return null;
}
