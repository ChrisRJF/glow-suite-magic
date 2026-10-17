// INACTIVE pure server candidate. No active entrypoint imports this file.
import { CREATE_ROLES, modeAllowed, type ActorContext } from './agendaCreateRoute.ts';
import { agendaModeFromFlagRead } from './agendaWriteCore.ts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS = new Set(['appointment_id', 'date', 'time', 'employee_id', 'expected_updated_at']);
export interface MoveBody { appointment_id: string; date: string; time: string; employee_id: string | null; expected_updated_at: string }
export interface MoveRouteDeps {
  verifyUser: (jwt: string) => Promise<string | null>;
  actorContext: (actor: string) => Promise<ActorContext | null>;
  readFlag: (tenant: string) => Promise<{ data: unknown; error: unknown }>;
  // Full authoritative tenant/demo-scoped read, including group siblings and sub_appointments.
  // Incomplete reads are not empty defaults. Null means missing/foreign.
  readAppointment: (id: string, context: ActorContext) => Promise<{ complete: boolean; employeeLinkCount: number; grouped: boolean } | null>;
  // Future service-only move_appointment_atomic_as, repeating protections under DB locks.
  callMoveAs: (actor: string, body: MoveBody) => Promise<unknown>;
}
export interface MoveRouteResult { status: number; data: { ok: boolean; code: string; appointment_id?: string; updated_at?: string } }
const fail = (status: number, code: string): MoveRouteResult => ({ status, data: { ok: false, code } });
export function validateMoveBody(value: unknown): MoveBody | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const b = value as Record<string, unknown>;
  if (Object.keys(b).some(k => !KEYS.has(k))) return null;
  if (typeof b.appointment_id !== 'string' || !UUID.test(b.appointment_id)) return null;
  if (b.employee_id !== null && (typeof b.employee_id !== 'string' || !UUID.test(b.employee_id))) return null;
  if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return null;
  const date = new Date(`${b.date}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== b.date) return null;
  if (typeof b.time !== 'string' || !/^([01]\d|2[0-3]):(00|15|30|45)$/.test(b.time)) return null;
  if (typeof b.expected_updated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(b.expected_updated_at) || !Number.isFinite(Date.parse(b.expected_updated_at))) return null;
  return b as unknown as MoveBody;
}
export async function handleMove(req: { method: string; jwt: string | null; body: unknown }, deps: MoveRouteDeps): Promise<MoveRouteResult> {
  if (!req.jwt) return fail(401, 'not_authenticated');
  const actor = await deps.verifyUser(req.jwt).catch(() => null);
  if (!actor || !UUID.test(actor)) return fail(401, 'not_authenticated');
  if (req.method !== 'POST') return fail(405, 'invalid_input');
  const body = validateMoveBody(req.body);
  if (!body) return fail(400, 'invalid_input');
  try {
    const ctx = await deps.actorContext(actor);
    if (!ctx || !UUID.test(ctx.tenantId) || !CREATE_ROLES.has(ctx.role)) return fail(403, 'forbidden');
    if (!modeAllowed(ctx)) return fail(403, 'mode_mismatch');
    const mode = agendaModeFromFlagRead(await deps.readFlag(ctx.tenantId));
    if (mode === 'blocked') return fail(503, 'unavailable');
    if (mode !== 'atomic') return fail(403, 'disabled');
    const apt = await deps.readAppointment(body.appointment_id, ctx);
    if (!apt) return fail(404, 'not_found');
    if (apt.complete !== true || !Number.isInteger(apt.employeeLinkCount) || apt.employeeLinkCount < 0 || typeof apt.grouped !== 'boolean') return fail(503, 'unavailable');
    if (apt.grouped) return fail(422, 'group_move_unsupported');
    if (apt.employeeLinkCount > 1) return fail(422, 'multi_employee_unsupported');
    const value = await deps.callMoveAs(actor, body);
    if (!value || typeof value !== 'object') return fail(503, 'failed');
    const r = value as Record<string, unknown>;
    if (r.ok === false && typeof r.code === 'string') return fail(r.code === 'stale' || r.code === 'conflict' ? 409 : 422, r.code);
    if (r.ok !== true || (r.code !== 'moved' && r.code !== 'noop') || r.appointment_id !== body.appointment_id || typeof r.updated_at !== 'string' || !Number.isFinite(Date.parse(r.updated_at))) return fail(503, 'failed');
    return { status: 200, data: { ok: true, code: r.code, appointment_id: body.appointment_id, updated_at: r.updated_at } };
  } catch {
    // Ambiguous outcome: no automatic retry or fallback, even if a write might have committed.
    return fail(503, 'unavailable');
  }
}
