// INACTIVE prepared adapter. Not imported anywhere. Copy to src/lib/ only after
// the RPC migration is approved and applied, and activation is approved separately.
//
// Every move path (day view, columns, mouse drag, touch drag + sheet, "Verplaats
// afspraak" button) must end in moveAppointmentAtomic(). The client never writes
// appointments / appointment_employees directly for a move.

import { supabase } from "@/integrations/supabase/client";

export interface MoveTarget { date: string; time: string; employeeId: string | null }

export type MoveCode =
  | "moved" | "noop" | "not_authenticated" | "invalid_input" | "not_found" | "invalid_status" | "stale"
  | "unknown_duration" | "outside_hours" | "invalid_local_time" | "multi_employee_unsupported"
  | "legacy_assignment_requires_choice" | "salon_closed" | "unknown_employee" | "employee_inactive"
  | "not_qualified" | "employee_absent" | "not_working" | "outside_working_hours" | "in_break" | "conflict";

export const MOVE_MESSAGES: Record<Exclude<MoveCode, "moved" | "noop">, string> = {
  not_authenticated: "Je bent uitgelogd. Log opnieuw in.",
  invalid_input: "Kies een geldige datum en tijd.",
  not_found: "Deze afspraak kun je niet verplaatsen.",
  invalid_status: "Een geannuleerde of afgeronde afspraak kun je niet verplaatsen.",
  stale: "De afspraak is net gewijzigd. Vernieuw de agenda en probeer opnieuw.",
  unknown_duration: "De duur van deze afspraak is onbekend. Controleer de behandeling.",
  outside_hours: "Deze tijd valt buiten de dag.",
  invalid_local_time: "Deze tijd bestaat niet door de zomertijd.",
  multi_employee_unsupported: "Deze afspraak heeft meerdere medewerkers. Verplaats hem via het dossier.",
  legacy_assignment_requires_choice: "Kies eerst een medewerker voor deze afspraak.",
  salon_closed: "De salon is dan gesloten.",
  unknown_employee: "Deze medewerker is niet gevonden.",
  employee_inactive: "Deze medewerker is niet actief.",
  not_qualified: "Deze medewerker doet deze behandeling niet.",
  employee_absent: "Deze medewerker is dan afwezig.",
  not_working: "Deze medewerker werkt dan niet.",
  outside_working_hours: "Deze tijd valt buiten de werktijden.",
  in_break: "Deze tijd valt in een pauze.",
  conflict: "Deze plek is al bezet.",
};

export async function moveAppointmentAtomic(
  appointmentId: string,
  target: MoveTarget,
  expectedUpdatedAt?: string | null,
): Promise<{ ok: boolean; code: MoveCode; message?: string }> {
  const { data, error } = await (supabase.rpc as any)("move_appointment_atomic", {
    _appointment_id: appointmentId,
    _target_date: target.date,
    _target_start: target.time,
    _target_employee_id: target.employeeId,
    _expected_updated_at: expectedUpdatedAt ?? null,
  });
  if (error) return { ok: false, code: "conflict", message: "Verplaatsen is niet gelukt. Er is niets gewijzigd." };
  const code = (data?.code ?? "invalid_input") as MoveCode;
  if (data?.ok) return { ok: true, code };
  return { ok: false, code, message: MOVE_MESSAGES[code as keyof typeof MOVE_MESSAGES] ?? "Verplaatsen is niet gelukt." };
}
