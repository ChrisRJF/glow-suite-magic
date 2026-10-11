// Agenda 3.0 step 3A: browser side of manual appointment create.
// Flag on for the salon -> ONLY the Edge Function `agenda-create-appointment`. Flag off -> caller keeps legacy.
// The server re-checks login, salon, role, demo/live and flag; this module never sends salon, actor, source or mode.

export type AgendaMode = "legacy" | "atomic" | "blocked";

export const BLOCKED_MESSAGE = "Agenda-instellingen konden niet worden gelezen. Er is niets opgeslagen. Probeer het opnieuw.";
export const UNKNOWN_MESSAGE = "We weten niet zeker of de afspraak is opgeslagen. Klik nogmaals op opslaan: dezelfde aanvraag wordt opnieuw verstuurd, er ontstaat geen dubbele afspraak.";
export const GROUP_EMPLOYEE_MESSAGE = "Kies voor extra personen in de groep nog geen medewerker: die koppeling kan nog niet betrouwbaar worden opgeslagen. Er is niets opgeslagen.";
export const GROUP_TIME_MESSAGE = "Kies voor elke persoon in de groep een tijd. Er is niets opgeslagen.";

const MESSAGES: Record<string, string> = {
  conflict: "Deze plek is al bezet. Er is niets opgeslagen.",
  slot_unavailable: "Deze plek is al bezet. Er is niets opgeslagen.",
  invalid_input: "Controleer klant, behandeling, datum en tijd. Er is niets opgeslagen.",
  request_mismatch: "Deze aanvraag is al verwerkt met andere gegevens. Open het afspraakformulier opnieuw.",
  disabled: BLOCKED_MESSAGE,
  unavailable: BLOCKED_MESSAGE,
  forbidden: "Je hebt geen rechten om afspraken te maken in deze salon. Er is niets opgeslagen.",
  mode_mismatch: "Je account hoort bij een andere omgeving (demo of live) dan deze salon. Er is niets opgeslagen.",
  not_authenticated: "Je bent uitgelogd. Log opnieuw in.",
  group_line_needs_time: GROUP_TIME_MESSAGE,
};

/** Flag read for the RESOLVED salon. Any doubt = blocked; no row / false = legacy. */
export function agendaModeFromReads(tenant: { data: unknown; error: unknown }, flag?: { data: unknown; error: unknown }): AgendaMode {
  if (tenant.error || typeof tenant.data !== "string" || !tenant.data) return "blocked";
  if (!flag || flag.error) return "blocked";
  if (flag.data == null) return "legacy";
  if (typeof flag.data !== "object") return "blocked";
  const v = (flag.data as Record<string, unknown>).atomic_agenda_enabled;
  if (v === true) return "atomic";
  if (v === false || v === undefined) return "legacy";
  return "blocked";
}

type Client = {
  rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }>;
  from: (t: string) => any;
};

export async function readAgendaMode(client: Client): Promise<AgendaMode> {
  try {
    const tenant = await client.rpc("current_tenant_id");
    if (tenant.error || typeof tenant.data !== "string") return "blocked";
    const flag = await client.from("tenant_feature_flags").select("atomic_agenda_enabled").eq("tenant_id", tenant.data).maybeSingle();
    return agendaModeFromReads(tenant, flag);
  } catch {
    return "blocked";
  }
}

export interface GroupLineInput { person_name: string; service_id: string; assigned_time?: string; assigned_employee?: string }
export interface CreateFormInput {
  customer_id: string; service_id: string; date: string; time: string;
  employee_ids: string[]; notes?: string | null; journey?: { id: string; session: number } | null;
  group: GroupLineInput[];
}
export interface CreateBody {
  request_id: string; customer_id: string | null; service_id: string; date: string; time: string;
  employee_ids: string[]; notes: string | null; journey_id: string | null; journey_session: number | null;
  sub_appointments: { person_name: string; service_id: string; time: string; employee_id: null }[] | null;
  send_confirmation: false;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Only allowed fields. Group lines need an own time; a name-based employee choice is refused, never mapped. */
export function buildCreateBody(requestId: string, f: CreateFormInput): { ok: true; body: CreateBody } | { ok: false; message: string } {
  if (!UUID.test(f.service_id) || (f.customer_id && !UUID.test(f.customer_id)) || !/^\d{4}-\d{2}-\d{2}$/.test(f.date) || !HHMM.test(f.time))
    return { ok: false, message: MESSAGES.invalid_input };
  if (f.employee_ids.some((e) => !UUID.test(e)) || new Set(f.employee_ids).size !== f.employee_ids.length)
    return { ok: false, message: "Kies de medewerker opnieuw. Er is niets opgeslagen." };
  const lines = f.group.filter((g) => g.person_name && g.service_id);
  for (const g of lines) {
    if (!g.assigned_time || !HHMM.test(g.assigned_time)) return { ok: false, message: GROUP_TIME_MESSAGE };
    if (!UUID.test(g.service_id)) return { ok: false, message: MESSAGES.invalid_input };
    const emp = (g.assigned_employee ?? "").trim();
    if (emp && emp !== "Niet toegewezen") return { ok: false, message: GROUP_EMPLOYEE_MESSAGE };
  }
  return { ok: true, body: {
    request_id: requestId, customer_id: f.customer_id || null, service_id: f.service_id, date: f.date, time: f.time,
    employee_ids: [...f.employee_ids], notes: f.notes ?? null,
    journey_id: f.journey?.id ?? null, journey_session: f.journey?.session ?? null,
    sub_appointments: lines.length ? lines.map((g) => ({ person_name: g.person_name.trim(), service_id: g.service_id, time: g.assigned_time!, employee_id: null })) : null,
    send_confirmation: false, // mail stays off until the separate mail activation
  } };
}

export type CreateOutcome =
  | { kind: "created"; appointmentId: string; replay: boolean }
  | { kind: "refused"; code: string; message: string }
  | { kind: "unknown"; message: string };

type Invoke = (name: string, opts: { body: unknown }) => Promise<{ data: any; error: any }>;

async function readErrorBody(error: any): Promise<any> {
  try { const ctx = error?.context; if (ctx && typeof ctx.json === "function") return await ctx.json(); } catch { /* ignore */ }
  return null;
}

/** Calls the Edge Function. Network loss, 5xx or unreadable answers = unknown (retry with SAME request_id + body). */
export async function createViaRoute(invoke: Invoke, body: CreateBody): Promise<CreateOutcome> {
  let res: { data: any; error: any };
  try { res = await invoke("agenda-create-appointment", { body }); } catch { return { kind: "unknown", message: UNKNOWN_MESSAGE }; }
  let payload = res.data;
  if (res.error) {
    const status = res.error?.context?.status;
    payload = await readErrorBody(res.error);
    if (typeof status !== "number" || status >= 500 || !payload || typeof payload !== "object") return { kind: "unknown", message: UNKNOWN_MESSAGE };
  }
  if (payload?.ok === true && typeof payload.appointment_id === "string") return { kind: "created", appointmentId: payload.appointment_id, replay: payload.replay === true };
  if (payload?.ok === false && typeof payload.code === "string") {
    if (payload.retry_same_request) return { kind: "unknown", message: UNKNOWN_MESSAGE };
    return { kind: "refused", code: payload.code, message: MESSAGES[payload.code] ?? payload.message ?? "Afspraak opslaan is niet gelukt. Er is niets opgeslagen." };
  }
  return { kind: "unknown", message: UNKNOWN_MESSAGE };
}
