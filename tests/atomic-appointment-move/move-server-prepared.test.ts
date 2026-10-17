import { describe, it, expect, vi } from 'vitest';
import { handleMove, validateMoveBody, type MoveRouteDeps } from '../../docs/prepared-patches/atomic-appointment-move/agendaMoveRoute';
import { routePreparedMove } from '../../docs/prepared-patches/atomic-appointment-move/agendaMoveClient';

const actor = '11111111-1111-4111-8111-111111111111';
const tenant = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const version = '2026-10-17T10:00:00.123456+00:00';
const body = { appointment_id: id, date: '2026-10-19', time: '11:15', employee_id: null, expected_updated_at: version };
const request = { method: 'POST', jwt: 'fictional-test-token', body };
const success = { ok: true, code: 'moved', appointment_id: id, updated_at: version };
function deps(): MoveRouteDeps {
  return {
    verifyUser: vi.fn().mockResolvedValue(actor),
    actorContext: vi.fn().mockResolvedValue({ tenantId: tenant, role: 'manager', salonIsDemo: false, membershipIsDemo: false }),
    readFlag: vi.fn().mockResolvedValue({ data: { atomic_agenda_enabled: true }, error: null }),
    readAppointment: vi.fn().mockResolvedValue({ complete: true, employeeLinkCount: 1, grouped: false, subAppointmentCount: 0 }),
    callMoveAs: vi.fn().mockResolvedValue(success),
  };
}
describe('inactive server move protections', () => {
  it('anonymous request performs no identity/context/read/write', async () => {
    const d = deps();
    expect((await handleMove({ ...request, jwt: null }, d)).status).toBe(401);
    expect(d.verifyUser).not.toHaveBeenCalled(); expect(d.actorContext).not.toHaveBeenCalled(); expect(d.callMoveAs).not.toHaveBeenCalled();
  });
  it('invalid identity blocks before privileged reads', async () => {
    const d = deps(); d.verifyUser = vi.fn().mockResolvedValue(null);
    expect((await handleMove(request, d)).status).toBe(401); expect(d.actorContext).not.toHaveBeenCalled();
  });
  it('authenticated GET is not a move', async () => {
    const d = deps(); expect((await handleMove({ ...request, method: 'GET' }, d)).status).toBe(405); expect(d.readFlag).not.toHaveBeenCalled();
  });
  it.each(['actor', 'tenant_id', 'user_id', 'is_demo', 'role'])('rejects client authority field %s', async key => {
    const d = deps(); expect((await handleMove({ ...request, body: { ...body, [key]: tenant } }, d)).status).toBe(400); expect(d.callMoveAs).not.toHaveBeenCalled();
  });
  it('rejects absent version, impossible dates and unaligned times', () => {
    for (const change of [{ expected_updated_at: undefined }, { date: '2026-02-30' }, { time: '11:07' }, { employee_id: 'Tino' }]) expect(validateMoveBody({ ...body, ...change })).toBeNull();
  });
  it('forbidden role cannot read appointments', async () => {
    const d = deps(); d.actorContext = vi.fn().mockResolvedValue({ tenantId: tenant, role: 'medewerker', salonIsDemo: false, membershipIsDemo: false });
    expect((await handleMove(request, d)).status).toBe(403); expect(d.readAppointment).not.toHaveBeenCalled();
  });
  it('demo/live mismatch blocks', async () => {
    const d = deps(); d.actorContext = vi.fn().mockResolvedValue({ tenantId: tenant, role: 'manager', salonIsDemo: false, membershipIsDemo: true });
    expect((await handleMove(request, d)).data.code).toBe('mode_mismatch'); expect(d.callMoveAs).not.toHaveBeenCalled();
  });
  it.each([null, { atomic_agenda_enabled: false }])('off/missing gate blocks writes', async data => {
    const d = deps(); d.readFlag = vi.fn().mockResolvedValue({ data, error: null });
    expect((await handleMove(request, d)).data.code).toBe('disabled'); expect(d.readAppointment).not.toHaveBeenCalled();
  });
  it('unreadable gate blocks', async () => {
    const d = deps(); d.readFlag = vi.fn().mockRejectedValue(new Error('unreadable'));
    expect((await handleMove(request, d)).status).toBe(503); expect(d.callMoveAs).not.toHaveBeenCalled();
  });
  it('cross-tenant appointment not found: no writes; read receives resolved salon', async () => {
    const d = deps(); d.readAppointment = vi.fn().mockResolvedValue(null);
    expect((await handleMove(request, d)).data.code).toBe('not_found');
    expect(d.readAppointment).toHaveBeenCalledWith(id, expect.objectContaining({ tenantId: tenant, salonIsDemo: false })); expect(d.callMoveAs).not.toHaveBeenCalled();
  });
  it.each([
    [{ complete: false, employeeLinkCount: 0, grouped: false, subAppointmentCount: 0 }, 'unavailable'],
    [{ complete: true, employeeLinkCount: 1, grouped: false }, 'unavailable'],
    [{ complete: true, employeeLinkCount: 2, grouped: false, subAppointmentCount: 0 }, 'multi_employee_unsupported'],
    [{ complete: true, employeeLinkCount: 2, grouped: true, subAppointmentCount: 0 }, 'multi_employee_unsupported'],
    [{ complete: true, employeeLinkCount: 1, grouped: false, subAppointmentCount: 1 }, 'sub_appointments_unsupported'],
  ])('protects incomplete/sub/multiple assignments before noop', async (snapshot, code) => {
    const d = deps(); d.readAppointment = vi.fn().mockResolvedValue(snapshot); d.callMoveAs = vi.fn().mockResolvedValue({ ...success, code: 'noop' });
    expect((await handleMove(request, d)).data.code).toBe(code); expect(d.callMoveAs).not.toHaveBeenCalled();
  });
  it('verified server actor and exact version reach wrapper', async () => {
    const d = deps(); expect((await handleMove(request, d)).data).toEqual({ ...success, booking_group_id: null }); expect(d.callMoveAs).toHaveBeenCalledWith(actor, body);
  });
  it('group member moves individually; wrapper must echo the same group', async () => {
    const d = deps(); d.readAppointment = vi.fn().mockResolvedValue({ complete: true, employeeLinkCount: 1, grouped: true, subAppointmentCount: 0 });
    d.callMoveAs = vi.fn().mockResolvedValue({ ...success, booking_group_id: tenant });
    expect((await handleMove(request, d)).data).toEqual({ ...success, booking_group_id: tenant }); expect(d.callMoveAs).toHaveBeenCalledWith(actor, body);
  });
  it('group membership lost or invented in result is not success', async () => {
    for (const [grouped, group] of [[true, null], [false, tenant], [true, 'x']] as const) {
      const d = deps(); d.readAppointment = vi.fn().mockResolvedValue({ complete: true, employeeLinkCount: 1, grouped, subAppointmentCount: 0 });
      d.callMoveAs = vi.fn().mockResolvedValue({ ...success, booking_group_id: group }); expect((await handleMove(request, d)).data.code).toBe('failed');
    }
  });
  it('rejects returned foreign appointment and fake success', async () => {
    for (const value of [{ ...success, appointment_id: tenant }, { ...success, code: 'something' }, { ...success, updated_at: null }]) {
      const d = deps(); d.callMoveAs = vi.fn().mockResolvedValue(value); expect((await handleMove(request, d)).data.ok).toBe(false);
    }
  });
});
describe('inactive client selects route before writes', () => {
  const apt = { id, updated_at: version };
  const target = { date: body.date, time: body.time, employeeId: null };
  it('legacy retains unchanged input including extra group/link data', async () => {
    const legacy = vi.fn().mockResolvedValue({ ok: true, code: 'moved' }); const invoke = vi.fn();
    const group = { ...apt, booking_group_id: tenant, employee_ids: [actor, tenant] };
    expect((await routePreparedMove(group, target, { mode: 'legacy', legacy, invoke })).ok).toBe(true);
    expect(legacy).toHaveBeenCalledWith(group, target); expect(invoke).not.toHaveBeenCalled();
  });
  it.each(['atomic', 'blocked'] as const)('missing wrapper in %s never invokes legacy', async mode => {
    const legacy = vi.fn(); expect((await routePreparedMove(apt, target, { mode, legacy })).ok).toBe(false); expect(legacy).not.toHaveBeenCalled();
  });
  it('missing version makes no server call', async () => {
    const invoke = vi.fn(); const legacy = vi.fn(); expect((await routePreparedMove({ id }, target, { mode: 'atomic', invoke, legacy })).code).toBe('missing_version'); expect(invoke).not.toHaveBeenCalled();
  });
  it.each(['stale', 'conflict', 'disabled', 'multi_employee_unsupported', 'sub_appointments_unsupported'])('atomic %s never falls back', async code => {
    const invoke = vi.fn().mockResolvedValue({ status: 422, data: { ok: false, code } }); const legacy = vi.fn();
    expect((await routePreparedMove(apt, target, { mode: 'atomic', invoke, legacy })).ok).toBe(false); expect(invoke).toHaveBeenCalledTimes(1); expect(legacy).not.toHaveBeenCalled();
  });
  it('ambiguous transport outcome has no retry or legacy write', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('lost response')); const legacy = vi.fn();
    expect((await routePreparedMove(apt, target, { mode: 'atomic', invoke, legacy })).code).toBe('unavailable'); expect(invoke).toHaveBeenCalledTimes(1); expect(legacy).not.toHaveBeenCalled();
  });
  it('accepts explicit server-confirmed move with exact version request', async () => {
    const invoke = vi.fn().mockResolvedValue({ status: 200, data: success }); const legacy = vi.fn();
    expect((await routePreparedMove(apt, target, { mode: 'atomic', invoke, legacy })).ok).toBe(true); expect(invoke).toHaveBeenCalledWith(body); expect(legacy).not.toHaveBeenCalled();
  });
});import { readFileSync } from 'node:fs';
describe('proposed DB wrapper stays service-only', () => {
  const sql = readFileSync('docs/proposed-migrations/2026-10-17_move_appointment_atomic_as.sql', 'utf8');
  it('grants only service_role and revokes authenticated/anon', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.move_appointment_atomic_as\([^)]*\)\s*FROM PUBLIC, anon, authenticated;/);
    expect(sql).not.toMatch(/GRANT[^;]*TO[^;]*(authenticated|anon)/);
    expect(sql).not.toMatch(/UPDATE public\.appointments|DELETE FROM public\.appointment_employees|booking_group_id\s*=/);
  });
  it('refuses sub-appointments and multi links before calling the move RPC', () => {
    const call = sql.indexOf('_r := public.move_appointment_atomic(');
    expect(sql.indexOf("'sub_appointments_unsupported'")).toBeLessThan(call);
    expect(sql.indexOf("'multi_employee_unsupported'")).toBeLessThan(call);
    expect(sql.indexOf('pg_advisory_xact_lock')).toBeLessThan(sql.indexOf('FOR UPDATE'));
  });
});
