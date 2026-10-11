// INACTIVE prepared agenda write core (step 3). Not imported by src/. Pure: RPC and the
// waitlist status update are injected, so this module cannot write appointments itself.
//
// Mode per salon (read from tenant_feature_flags, read-only for salons):
//   "atomic"  = atomic_agenda_enabled === true  -> ONLY the RPCs, never a legacy write, also not on error.
//   "legacy"  = flag false or no flag row       -> today's unchanged code path (until step 4, the guard).
//   "blocked" = flag could not be read          -> no write at all, message shown.
// Publishing this frontend therefore changes nothing for salons with the flag off.

export type AgendaMode = "atomic" | "legacy" | "blocked";

export function agendaModeFromFlagRead(read: { data: unknown; error: unknown }): AgendaMode {
  if (read.error) return "blocked";
  if (read.data == null) return "legacy";
  if (typeof read.data !== "object") return "blocked";
  const v = (read.data as Record<string, unknown>).atomic_agenda_enabled;
  if (v === true) return "atomic";
  if (v === false || v === undefined) return "legacy";
  return "blocked"; // "true", 1, null: never guess
}

/** Single switch every write path goes through. The legacy function is unreachable in atomic mode. */
export async function routeAgendaWrite<T>(
  mode: AgendaMode,
  atomic: () => Promise<T>,
  legacy: () => Promise<T>,
  blocked: () => T,
): Promise<T> {
  if (mode === "atomic") return atomic();
  if (mode === "legacy") return legacy();
  return blocked();
}

export const BLOCKED_MESSAGE = "Opslaan in de agenda is even niet beschikbaar. Er is niets opgeslagen.";

export type CreateCode =
  | "created" | "disabled" | "unavailable" | "failed" | "not_authenticated" | "not_found" | "invalid_input"
  | "invalid_employee" | "group_line_needs_time" | "invalid_local_time" | "outside_hours" | "salon_closed"
  | "unknown_employee" | "employee_inactive" | "not_qualified" | "employee_absent" | "not_working"
  | "outside_working_hours" | "in_break" | "conflict" | "slot_unavailable" | "unknown_duration";

export const CREATE_MESSAGES: Record<Exclude<CreateCode, "created">, string> = {
  disabled: BLOCKED_MESSAGE,
  unavailable: BLOCKED_MESSAGE,
  failed: "Afspraak opslaan is niet gelukt. Er is niets opgeslagen.",
  not_authenticated: "Je bent uitgelogd. Log opnieuw in.",
  not_found: "Klant of behandeling niet gevonden. Er is niets opgeslagen.",
  invalid_input: "Controleer datum, tijd en behandeling. Er is niets opgeslagen.",
  invalid_employee: "Kies de medewerker opnieuw. Er is niets opgeslagen.",
  group_line_needs_time: "Kies voor elke persoon in de groep een tijd. Er is niets opgeslagen.",
  invalid_local_time: "Deze tijd bestaat niet of komt dubbel voor door de zomertijd.",
  outside_hours: "Deze tijd valt buiten de dag.",
  salon_closed: "De salon is dan gesloten.",
  unknown_employee: "Deze medewerker is niet gevonden.",
  employee_inactive: "Deze medewerker is niet actief.",
  not_qualified: "Deze medewerker doet deze behandeling niet.",
  employee_absent: "Deze medewerker is dan afwezig.",
  not_working: "Deze medewerker werkt dan niet.",
  outside_working_hours: "Deze tijd valt buiten de werktijden.",
  in_break: "Deze tijd valt in een pauze.",
  conflict: "Deze plek is al bezet. Er is niets opgeslagen.",
  slot_unavailable: "Deze plek is al bezet. Er is niets opgeslagen.",
  unknown_duration: "De duur van deze behandeling is onbekend.",
};

export type RpcFn = (name: string, args: Record<string, unknown>) =>
  Promise<{ data: any; error: { code?: string; message?: string; status?: number } | null }>;

export interface CreateInput {
  customerId: string;
  serviceId: string;
  date: string;          // Amsterdam local date YYYY-MM-DD
  time: string;          // Amsterdam wall clock HH:MM
  employeeIds: string[]; // UUIDs only, first = primary, [] = not assigned
  notes?: string;
  source: "manual" | "waitlist";
  journey?: { id: string; session: number } | null;
  group?: { personName: string; serviceId: string; time?: string | null; employeeId?: string | null }[];
}

export interface CreateResult { ok: boolean; code: CreateCode; message?: string; appointmentId?: string; line?: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code: Exclude<CreateCode, "created">, line?: number): CreateResult =>
  ({ ok: false, code, message: CREATE_MESSAGES[code], ...(line !== undefined ? { line } : {}) });
const isUnavailable = (e: { code?: string; status?: number }) =>
  e.code === "PGRST202" || e.code === "42883" || e.code === "42501" || e.status === 404;

/** Atomic create. Gate is checked BEFORE the RPC; any error = blocked, no fallback insert. */
export async function guardedCreate(input: CreateInput, deps: { mode: AgendaMode; rpc: RpcFn }): Promise<CreateResult> {
  if (deps.mode !== "atomic") return fail("disabled");
  if (!input.employeeIds.every((id) => UUID.test(id))) return fail("invalid_employee");
  const group = (input.group || []).filter((g) => g.personName && g.serviceId);
  for (let i = 0; i < group.length; i++) {
    if (!group[i].time) return fail("group_line_needs_time", i + 1);          // never guessed
    if (group[i].employeeId && !UUID.test(group[i].employeeId!)) return fail("invalid_employee", i + 1);
  }
  let res: Awaited<ReturnType<RpcFn>>;
  try {
    res = await deps.rpc("create_appointment_atomic", {
      _customer_id: input.customerId,
      _service_id: input.serviceId,
      _date: input.date,
      _time: input.time,
      _employee_ids: input.employeeIds,
      _notes: input.notes ?? "",
      _source: input.source,
      _journey_id: input.journey?.id ?? null,
      _journey_session: input.journey?.session ?? null,
      _sub_appointments: group.map((g) => ({
        person_name: g.personName, service_id: g.serviceId, time: g.time, employee_id: g.employeeId ?? null,
      })),
    });
  } catch {
    return fail("unavailable");
  }
  if (res.error) return fail(isUnavailable(res.error) ? "unavailable" : "failed");
  const code = res.data?.code as string | undefined;
  if (res.data?.ok === true && code === "created" && res.data?.appointment_id) {
    return { ok: true, code: "created", appointmentId: res.data.appointment_id };
  }
  if (code && code !== "created" && code in CREATE_MESSAGES) return fail(code as Exclude<CreateCode, "created">, res.data?.line);
  return fail("failed");
}

/** Tomorrow as an Amsterdam calendar date (not browser time). */
export function amsterdamTomorrow(now: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).reduce<Record<string, string>>((a, x) => { a[x.type] = x.value; return a; }, {});
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + 1));
  return d.toISOString().slice(0, 10);
}

export interface WaitlistEntry { id: string; customer_id: string; service_id: string; preferred_time?: string | null }

/** Waitlist placement: entry is marked "geplaatst" ONLY after the appointment was created. */
export async function guardedPlaceWaitlist(
  entry: WaitlistEntry,
  deps: { mode: AgendaMode; rpc: RpcFn; now: Date; markPlaced: (id: string) => Promise<boolean> },
): Promise<CreateResult & { marked: boolean }> {
  const time = /^([01]\d|2[0-3]):[0-5]\d/.test(entry.preferred_time || "") ? entry.preferred_time!.slice(0, 5) : "10:00";
  const res = await guardedCreate({
    customerId: entry.customer_id, serviceId: entry.service_id, date: amsterdamTomorrow(deps.now), time,
    employeeIds: [], // preferred_employee is a name: never resolved
    notes: "Geplaatst vanuit wachtlijst", source: "waitlist",
  }, deps);
  if (!res.ok) return { ...res, marked: false };
  const marked = await deps.markPlaced(entry.id).catch(() => false);
  return { ...res, marked };
}
