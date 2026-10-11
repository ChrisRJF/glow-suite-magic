// INACTIVE prepared server route core for step 3A: manual appointment create.
// Future Edge Function `agenda-create-appointment` (entrypoint: ./agenda-create-appointment/index.ts).
// Not imported by src/ or any active entrypoint. Pure: identity, actor context, flag read and the RPC
// are injected, so this module cannot write anything itself. No service_role key ever reaches the browser.
//
// Browser sends: request_id (uuid made once per opened form and reused on every retry), customer_id,
// service_id, date "YYYY-MM-DD", time "HH:MM" (Europe/Amsterdam wall time), employee_ids (UUIDs),
// notes, journey_id/session, sub_appointments, send_confirmation.
// Never accepted from the browser: salon, actor, source, demo mode, role.
//
// Requires docs/proposed-migrations/2026-10-11_agenda_create_route.sql (live, unused) and
// 2026-10-11_agenda_create_requests_grants_fix.sql (proposed).

import { agendaModeFromFlagRead, CREATE_MESSAGES, type CreateCode } from "./agendaWriteCore.ts";

export const CREATE_ROLES = new Set(["eigenaar", "admin", "manager", "receptie"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_KEYS = new Set(["request_id", "customer_id", "service_id", "date", "time", "employee_ids", "notes",
  "journey_id", "journey_session", "sub_appointments", "send_confirmation"]);

export interface CreateBody {
  request_id: string; customer_id: string | null; service_id: string; date: string; time: string;
  employee_ids: string[]; notes?: string | null; journey_id?: string | null; journey_session?: number | null;
  sub_appointments?: unknown[] | null; send_confirmation?: boolean;
}

export type RpcResult = { ok: true; code: "created"; appointment_id: string; booking_group_id?: string | null; booking_token?: string | null }
  | { ok: false; code: string; line?: number };

/** Server-side context of the verified actor (same rule as public.agenda_actor_tenant). */
export interface ActorContext {
  tenantId: string;
  /** owner -> "eigenaar"; staff -> role of the single active user_access membership */
  role: string;
  /** mode of the salon (settings of the owner: is_demo OR demo_mode) */
  salonIsDemo: boolean;
  /** staff only: user_access.is_demo of the active membership; null for the owner */
  membershipIsDemo: boolean | null;
}

export interface RouteDeps {
  /** Must verify the token with Supabase Auth (auth.getUser), never decode only. null = invalid/expired. */
  verifyUser: (jwt: string) => Promise<string | null>;
  /** service_role reads. null = no salon, no or ambiguous membership. Throw = unreadable. */
  actorContext: (userId: string) => Promise<ActorContext | null>;
  /** service_role read of tenant_feature_flags for the RESOLVED tenant; error = fail closed. */
  readFlag: (tenantId: string) => Promise<{ data: unknown; error: unknown }>;
  /** service_role rpc("create_appointment_atomic_as", { _actor, ...args }). The DB resolves and re-checks
   *  salon, role, flag and membership itself; tenantId is passed only for logging. Source fixed in the DB. */
  callCreateAs: (actor: string, tenantId: string, args: Record<string, unknown>) => Promise<RpcResult & { replay?: boolean; send_confirmation?: boolean }>;
  /** Optional hand-off to the INACTIVE manual confirmation (only after a complete first create). */
  onCreated?: (info: { tenantId: string; appointmentId: string; sendToCustomer: boolean }) => Promise<void>;
}

type FailCode = CreateCode | "forbidden" | "mode_mismatch" | "request_mismatch";
export type RouteResult =
  | { status: 200; ok: true; code: "created"; appointment_id: string; booking_group_id: string | null; replay?: boolean; message: string }
  | { status: 400 | 401 | 403 | 409 | 422 | 503; ok: false; code: FailCode; message: string; retry_same_request?: true };

export const ROUTE_MESSAGES: Record<"forbidden" | "mode_mismatch" | "request_mismatch" | "created", string> = {
  created: "Afspraak opgeslagen.",
  forbidden: "Je hebt geen rechten om afspraken te maken in deze salon. Er is niets opgeslagen.",
  mode_mismatch: "Je account hoort bij een andere omgeving (demo of live) dan deze salon. Er is niets opgeslagen.",
  request_mismatch: "Deze aanvraag is al verwerkt met andere gegevens. Open het afspraakformulier opnieuw.",
};
export const messageFor = (code: string): string =>
  (ROUTE_MESSAGES as Record<string, string>)[code] ?? (CREATE_MESSAGES as Record<string, string>)[code] ?? CREATE_MESSAGES.failed;

const fail = (status: 400 | 401 | 403 | 409 | 422 | 503, code: FailCode, extra: { retry_same_request?: true } = {}): RouteResult =>
  ({ status, ok: false, code, message: messageFor(code), ...extra });

export function validate(b: any): CreateBody | null {
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  for (const k of Object.keys(b)) if (!ALLOWED_KEYS.has(k)) return null; // salon, actor, source, demo: never client-chosen
  if (!UUID.test(String(b.request_id || "")) || !UUID.test(String(b.service_id || ""))) return null;
  if (b.customer_id != null && !UUID.test(String(b.customer_id))) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.time || ""))) return null;
  if (!Array.isArray(b.employee_ids) || b.employee_ids.length > 5 || b.employee_ids.some((x: unknown) => !UUID.test(String(x)))) return null;
  if (new Set(b.employee_ids).size !== b.employee_ids.length) return null;
  if (b.notes != null && (typeof b.notes !== "string" || b.notes.length > 2000)) return null;
  if (b.journey_id != null && !UUID.test(String(b.journey_id))) return null;
  if (b.journey_session != null && !Number.isInteger(b.journey_session)) return null;
  if (b.sub_appointments != null && (!Array.isArray(b.sub_appointments) || b.sub_appointments.length > 10)) return null;
  if (b.send_confirmation != null && typeof b.send_confirmation !== "boolean") return null;
  return b as CreateBody;
}

/** Demo/live separation: staff membership mode must equal the salon mode. Owners use the salon mode itself. */
export function modeAllowed(ctx: ActorContext): boolean {
  if (typeof ctx.salonIsDemo !== "boolean") return false;
  if (ctx.role === "eigenaar") return ctx.membershipIsDemo === null;
  return typeof ctx.membershipIsDemo === "boolean" && ctx.membershipIsDemo === ctx.salonIsDemo;
}

export async function handleCreate(req: { jwt: string | null; body: unknown }, deps: RouteDeps): Promise<RouteResult> {
  if (!req.jwt) return fail(401, "not_authenticated");
  const userId = await deps.verifyUser(req.jwt).catch(() => null);
  if (!userId || !UUID.test(userId)) return fail(401, "not_authenticated");
  const body = validate(req.body);
  if (!body) return fail(400, "invalid_input");

  let ctx: ActorContext | null;
  try { ctx = await deps.actorContext(userId); } catch { return fail(503, "unavailable"); }
  if (!ctx || !CREATE_ROLES.has(ctx.role)) return fail(403, "forbidden");
  if (!modeAllowed(ctx)) return fail(403, "mode_mismatch");

  // Flag BEFORE any database write; unreadable = blocked, off = this route refuses (legacy stays in the browser).
  const mode = agendaModeFromFlagRead(await deps.readFlag(ctx.tenantId).catch((e) => ({ data: null, error: e })));
  if (mode === "blocked") return fail(503, "unavailable");
  if (mode === "legacy") return fail(403, "disabled");

  // Idempotency lives in the database: request row + appointment in ONE transaction.
  let rpc: RpcResult & { replay?: boolean; send_confirmation?: boolean };
  try {
    rpc = await deps.callCreateAs(userId, ctx.tenantId, {
      _request_id: body.request_id, _send_confirmation: body.send_confirmation === true,
      _customer_id: body.customer_id, _service_id: body.service_id, _date: body.date, _time: body.time,
      _employee_ids: body.employee_ids, _notes: body.notes ?? null,
      _journey_id: body.journey_id ?? null, _journey_session: body.journey_session ?? null,
      _sub_appointments: body.sub_appointments ?? null,
    });
  } catch {
    // Unknown outcome: the browser retries with the SAME request_id; the DB replays or creates once.
    return fail(503, "failed", { retry_same_request: true });
  }
  if (!rpc || typeof rpc !== "object") return fail(503, "failed", { retry_same_request: true });
  if (!rpc.ok) {
    const code = String(rpc.code) as FailCode;
    const status = code === "conflict" || code === "slot_unavailable" || code === "request_mismatch" ? 409
      : code === "forbidden" || code === "disabled" ? 403 : 422;
    return fail(status, code);
  }
  const result: RouteResult = { status: 200, ok: true, code: "created", appointment_id: rpc.appointment_id,
    booking_group_id: rpc.booking_group_id ?? null, message: ROUTE_MESSAGES.created, ...(rpc.replay ? { replay: true } : {}) };
  // Confirmation only after a committed first create, never on replay; the stored choice is authoritative.
  if (!rpc.replay && deps.onCreated) await deps.onCreated({ tenantId: ctx.tenantId, appointmentId: rpc.appointment_id, sendToCustomer: rpc.send_confirmation === true }).catch(() => {});
  return result;
}
