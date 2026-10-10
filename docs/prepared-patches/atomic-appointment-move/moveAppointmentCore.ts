// INACTIVE prepared adapter core (fase 2). Not imported by src/. Pure: the RPC is injected,
// so there is no way for this module to write appointments / appointment_employees itself.
//
// Rules:
//  * Every move path (mouse drag, touch drag + sheet, columns, "Verplaats afspraak") calls guardedMove().
//  * Gate off, RPC missing, network error or missing updated_at => BLOCKED with a message.
//    There is NO fallback to the old appointments.update + appointment_employees delete/insert.

export interface MoveTarget { date: string; time: string; employeeId: string | null }
export interface MoveAppointment { id: string; updated_at?: string | null }

export type MoveCode =
  | "moved" | "noop" | "not_authenticated" | "invalid_input" | "not_found" | "invalid_status" | "stale"
  | "missing_version" | "ambiguous_time" | "unknown_duration" | "outside_hours" | "invalid_local_time"
  | "multi_employee_unsupported" | "legacy_assignment_requires_choice" | "salon_closed" | "unknown_employee"
  | "employee_inactive" | "not_qualified" | "employee_absent" | "not_working" | "outside_working_hours"
  | "in_break" | "conflict" | "disabled" | "unavailable" | "failed";

export const MOVE_MESSAGES: Record<Exclude<MoveCode, "moved" | "noop">, string> = {
  not_authenticated: "Je bent uitgelogd. Log opnieuw in.",
  invalid_input: "Kies een geldige datum en tijd.",
  not_found: "Deze afspraak kun je niet verplaatsen.",
  invalid_status: "Een geannuleerde of afgeronde afspraak kun je niet verplaatsen.",
  stale: "De afspraak is net gewijzigd. Vernieuw de agenda en probeer opnieuw.",
  missing_version: "Vernieuw de agenda en probeer opnieuw. Er is niets gewijzigd.",
  ambiguous_time: "De tijd van deze afspraak is niet zeker. Controleer de afspraak in het dossier.",
  unknown_duration: "De duur van deze afspraak is onbekend. Controleer de behandeling.",
  outside_hours: "Deze tijd valt buiten de dag.",
  invalid_local_time: "Deze tijd bestaat niet of komt dubbel voor door de zomertijd.",
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
  disabled: "Verplaatsen is even niet beschikbaar. Er is niets gewijzigd.",
  unavailable: "Verplaatsen is even niet beschikbaar. Er is niets gewijzigd.",
  failed: "Verplaatsen is niet gelukt. Er is niets gewijzigd.",
};

export type RpcFn = (name: string, args: Record<string, unknown>) =>
  Promise<{ data: any; error: { code?: string; message?: string; status?: number } | null }>;

export interface MoveDeps { rpc: RpcFn; enabled: boolean }
export interface MoveResult { ok: boolean; code: MoveCode; message?: string; updatedAt?: string }

const block = (code: Exclude<MoveCode, "moved" | "noop">): MoveResult => ({ ok: false, code, message: MOVE_MESSAGES[code] });

/** PostgREST "function not found" / not deployed / no permission => unavailable (blocked). */
function isUnavailable(err: { code?: string; message?: string; status?: number }): boolean {
  return err.code === "PGRST202" || err.code === "42883" || err.code === "42501" || err.status === 404;
}

export async function guardedMove(apt: MoveAppointment, target: MoveTarget, deps: MoveDeps): Promise<MoveResult> {
  if (!deps.enabled) return block("disabled");
  if (!apt?.id) return block("not_found");
  if (!apt.updated_at) return block("missing_version");
  let res: Awaited<ReturnType<RpcFn>>;
  try {
    res = await deps.rpc("move_appointment_atomic", {
      _appointment_id: apt.id,
      _target_date: target.date,
      _target_start: target.time,
      _target_employee_id: target.employeeId,
      _expected_updated_at: apt.updated_at,
    });
  } catch {
    return block("unavailable");
  }
  if (res.error) return block(isUnavailable(res.error) ? "unavailable" : "failed");
  const code = res.data?.code as MoveCode | undefined;
  if (res.data?.ok === true && (code === "moved" || code === "noop")) {
    return { ok: true, code, updatedAt: res.data?.updated_at };
  }
  if (code && code in MOVE_MESSAGES) return block(code as Exclude<MoveCode, "moved" | "noop">);
  return block("failed");
}

/**
 * Read side for mixed storage (mirror of SQL appointment_busy_candidates).
 * canonical: appointment_date is real UTC; legacy: wall clock stored as UTC; ambiguous: neither.
 */
export function appointmentLocalSlot(appointmentDate: string, startTime: string | null | undefined):
  { kind: "canonical" | "legacy" | "ambiguous"; date: string | null; time: string | null } {
  const d = new Date(appointmentDate);
  if (Number.isNaN(d.getTime())) return { kind: "ambiguous", date: null, time: null };
  const ams = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).reduce<Record<string, string>>((a, p) => { a[p.type] = p.value; return a; }, {});
  const amsDate = `${ams.year}-${ams.month}-${ams.day}`; const amsTime = `${ams.hour}:${ams.minute}`;
  const iso = d.toISOString(); const utcDate = iso.slice(0, 10); const utcTime = iso.slice(11, 16);
  const st = (startTime || "").slice(0, 5);
  if (st && st === amsTime) return { kind: "canonical", date: amsDate, time: st };
  if (st && st === utcTime) return { kind: "legacy", date: utcDate, time: st };
  return { kind: "ambiguous", date: null, time: null };
}
