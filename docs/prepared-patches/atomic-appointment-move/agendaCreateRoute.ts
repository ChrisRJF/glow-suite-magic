// INACTIVE prepared server route core for step 3A: manual appointment create.
// Future Edge Function `agenda-create-appointment`. Not imported by src/ or any entrypoint.
// Pure: identity, flag read, idempotency claim and the RPC are injected, so this module
// cannot write anything itself. No service_role key ever reaches the browser.
//
// Browser sends: request_id (uuid made once per opened form), customer_id, service_id,
// date "YYYY-MM-DD", time "HH:MM" (Europe/Amsterdam wall time), employee_ids (UUIDs),
// notes, journey_id/session, sub_appointments. Tenant, demo mode, source and role are server-side.
//
// BLOCKER (see README 3A): the live create_appointment_atomic uses auth.uid() as tenant and for the
// flag lookup. Called with service_role, auth.uid() is NULL -> not_authenticated; called as a
// receptie/manager login, tenant != auth.uid(). The injected `callCreateAs` therefore requires the
// proposed service_role-only wrapper in docs/proposed-migrations/2026-10-11_agenda_create_route.sql.

import { agendaModeFromFlagRead, type CreateCode } from "./agendaWriteCore";

export const CREATE_ROLES = new Set(["eigenaar", "admin", "manager", "receptie"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CreateBody {
  request_id: string; customer_id: string | null; service_id: string; date: string; time: string;
  employee_ids: string[]; notes?: string | null; journey_id?: string | null; journey_session?: number | null;
  sub_appointments?: unknown[] | null; send_confirmation?: boolean;
}

export type RpcResult = { ok: true; code: "created"; appointment_id: string; booking_group_id?: string | null; booking_token?: string | null }
  | { ok: false; code: string; line?: number };

export interface RouteDeps {
  verifyUser: (jwt: string) => Promise<string | null>;
  /** Same rule as public.current_tenant_id() for this login (staff -> owner tenant). */
  tenantForUser: (userId: string) => Promise<{ tenantId: string; isDemo: boolean } | null>;
  rolesForUser: (userId: string) => Promise<string[] | null>;
  /** Service-role read of tenant_feature_flags for the RESOLVED tenant; error = fail closed. */
  readFlag: (tenantId: string) => Promise<{ data: unknown; error: unknown }>;
  /** Durable claim (proposed table agenda_create_requests, unique (tenant_id, request_id)).
   *  Returns "new", or the stored result of an earlier identical request, or "in_progress". */
  claim: (tenantId: string, requestId: string, bodyHash: string) =>
    Promise<{ state: "new" } | { state: "done"; result: RouteResult } | { state: "in_progress" } | { state: "mismatch" }>;
  finish: (tenantId: string, requestId: string, result: RouteResult) => Promise<void>;
  release: (tenantId: string, requestId: string) => Promise<void>;
  /** Proposed wrapper create_appointment_atomic_as(_actor, _tenant, ...); source is fixed by the route. */
  callCreateAs: (actor: string, tenantId: string, args: Record<string, unknown>) => Promise<RpcResult>;
  /** Optional hand-off to the INACTIVE manual confirmation (only after a complete create). */
  onCreated?: (info: { tenantId: string; appointmentId: string; sendToCustomer: boolean }) => Promise<void>;
}

export type RouteResult =
  | { status: 200; ok: true; code: "created"; appointment_id: string; booking_group_id: string | null; replay?: boolean }
  | { status: 400 | 401 | 403 | 409 | 422 | 503; ok: false; code: CreateCode | "forbidden" | "in_progress" | "request_mismatch" };

const fail = (status: 400 | 401 | 403 | 409 | 422 | 503, code: any): RouteResult => ({ status, ok: false, code });

export function bodyHash(b: CreateBody): string {
  return JSON.stringify([b.customer_id, b.service_id, b.date, b.time, [...b.employee_ids], b.notes ?? null,
    b.journey_id ?? null, b.journey_session ?? null, b.sub_appointments ?? null]);
}

export function validate(b: any): CreateBody | null {
  if (!b || typeof b !== "object") return null;
  if (!UUID.test(String(b.request_id || "")) || !UUID.test(String(b.service_id || ""))) return null;
  if (b.customer_id != null && !UUID.test(String(b.customer_id))) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.time || ""))) return null;
  if (!Array.isArray(b.employee_ids) || b.employee_ids.length > 5 || b.employee_ids.some((x: unknown) => !UUID.test(String(x)))) return null;
  if (new Set(b.employee_ids).size !== b.employee_ids.length) return null;
  if ("source" in b || "user_id" in b || "tenant_id" in b || "is_demo" in b) return null; // never client-chosen
  return b as CreateBody;
}

export async function handleCreate(req: { jwt: string | null; body: unknown }, deps: RouteDeps): Promise<RouteResult> {
  if (!req.jwt) return fail(401, "not_authenticated");
  const userId = await deps.verifyUser(req.jwt).catch(() => null);
  if (!userId) return fail(401, "not_authenticated");
  const body = validate(req.body);
  if (!body) return fail(400, "invalid_input");
  const tenant = await deps.tenantForUser(userId).catch(() => null);
  const roles = await deps.rolesForUser(userId).catch(() => null);
  if (!tenant || !roles || !roles.some((r) => CREATE_ROLES.has(r))) return fail(403, "forbidden");

  // Flag BEFORE any database write; unreadable = blocked, off = this route refuses (legacy stays in the browser).
  const mode = agendaModeFromFlagRead(await deps.readFlag(tenant.tenantId).catch((e) => ({ data: null, error: e })));
  if (mode === "blocked") return fail(503, "unavailable");
  if (mode === "legacy") return fail(403, "disabled");

  const c = await deps.claim(tenant.tenantId, body.request_id, bodyHash(body)).catch(() => null);
  if (!c) return fail(503, "unavailable");
  if (c.state === "done") return c.result.ok ? { ...c.result, replay: true } : c.result;
  if (c.state === "in_progress") return fail(409, "in_progress");
  if (c.state === "mismatch") return fail(409, "request_mismatch");

  let rpc: RpcResult;
  try {
    rpc = await deps.callCreateAs(userId, tenant.tenantId, {
      _customer_id: body.customer_id, _service_id: body.service_id, _date: body.date, _time: body.time,
      _employee_ids: body.employee_ids, _notes: body.notes ?? null, _source: "manual",
      _journey_id: body.journey_id ?? null, _journey_session: body.journey_session ?? null,
      _sub_appointments: body.sub_appointments ?? null,
    });
  } catch {
    await deps.release(tenant.tenantId, body.request_id).catch(() => {});
    return fail(503, "failed"); // the RPC is one transaction: an error means nothing was saved
  }
  if (!rpc.ok) {
    const result = fail(rpc.code === "conflict" || rpc.code === "slot_unavailable" ? 409 : 422, rpc.code as CreateCode);
    await deps.release(tenant.tenantId, body.request_id).catch(() => {}); // user may correct and retry
    return result;
  }
  const result: RouteResult = { status: 200, ok: true, code: "created", appointment_id: rpc.appointment_id, booking_group_id: rpc.booking_group_id ?? null };
  await deps.finish(tenant.tenantId, body.request_id, result).catch(() => {});
  // Confirmation only after a complete create, never on replay or failure; its own guards still apply.
  if (deps.onCreated) await deps.onCreated({ tenantId: tenant.tenantId, appointmentId: rpc.appointment_id, sendToCustomer: body.send_confirmation === true }).catch(() => {});
  return result;
}
