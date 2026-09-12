import { Sparkles } from "lucide-react";
import { useDossierOverview } from "@/hooks/useDossierOverview";
import { nextAction } from "@/lib/dossierInsights";
import { AiSummaryButton } from "./AiSummaryButton";

/**
 * P4 samenvatting: compacte, regelgebaseerde weergave van bestaande dossierdata.
 * Wordt niet opgeslagen als dossierstuk en bevat geen medische interpretatie.
 */
export function DossierSummaryCard({ customerId }: { customerId: string }) {
  const o = useDossierOverview(customerId);
  if (o.loading) return null;

  const recent = o.appointments.slice(0, 3);
  const serviceName = (id: string | null) => o.services.find((s) => s.id === id)?.name || "Afspraak";
  const openForms = o.forms.filter((f) => f.status !== "completed" && f.status !== "cancelled" && f.status !== "expired");
  const completedForms = o.forms.filter((f) => f.status === "completed");
  const completedRecords = o.records.filter((r) => r.status === "completed");
  const activeJourney = o.journeys.find((j) => j.status !== "afgerond") || o.journeys[0];
  const marketing = o.consents.find((c) => c.consent_type.startsWith("marketing"));

  const action = nextAction({
    forms: openForms.map((f) => ({ title: f.title, ok: false, state: "missing" })),
    treatmentRecordRequired: false,
    treatmentRecordDone: true,
    beforePhotos: 1,
    afterPhotos: 1,
    openAlerts: o.openAlerts,
    previousRecord: completedRecords.length > 0,
    appointmentCompleted: false,
    aftercareAvailable: true,
    journeyNeedsFollowUp: Boolean(
      activeJourney &&
        !o.appointments.some((a) => a.journey_id === activeJourney.id && new Date(a.appointment_date) > new Date()),
    ),
  });

  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-primary" /> Samenvatting
        </h4>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          Automatisch samengevat
        </span>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          Recente afspraken:{" "}
          {recent.length === 0
            ? "nog geen"
            : recent
                .map(
                  (a) =>
                    `${serviceName(a.service_id)} op ${new Date(a.appointment_date).toLocaleDateString("nl-NL", { dateStyle: "medium" })}`,
                )
                .join(" · ")}
        </p>
        <p>
          Formulieren: {completedForms.length} ingevuld, {openForms.length} openstaand
        </p>
        <p>
          Marketingtoestemming:{" "}
          {marketing ? (marketing.event === "granted" ? "gegeven" : "ingetrokken") : "niet vastgelegd"}
        </p>
        <p>
          Behandeltraject:{" "}
          {activeJourney
            ? `${activeJourney.name} · ${o.appointments.filter((a) => a.journey_id === activeJourney.id).length}/${activeJourney.planned_sessions ?? "?"} sessies`
            : "geen"}
        </p>
        <p>Afgeronde behandelverslagen: {completedRecords.length}</p>
        <p>Aandachtspunten: {o.openAlerts > 0 ? `${o.openAlerts} open` : "geen open punten"}</p>
        <p className="font-medium text-foreground">
          Volgende actie: {action ? action.label : "niets, dit dossier is bij"}
        </p>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Alleen administratief overzicht uit bestaande gegevens. Geen diagnose of behandeladvies.
      </p>

      <AiSummaryButton label="AI-samenvatting maken" action="dossier_summary" customerId={customerId} />
    </div>
  );
}
