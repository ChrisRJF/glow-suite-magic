// INACTIVE facade. No direct browser RPC, feature activation or automatic retry.
import { guardedMove, type MoveAppointment, type MoveTarget, type MoveResult } from './moveAppointmentCore';
import type { AgendaMode } from './agendaWriteCore';
import type { MoveBody, MoveRouteResult } from './agendaMoveRoute';
export interface MoveClientDeps {
  mode: AgendaMode;
  // Undefined until reviewed service-only wrapper AND deployed route exist.
  invoke?: (body: MoveBody) => Promise<MoveRouteResult>;
  legacy: (apt: MoveAppointment, target: MoveTarget) => Promise<MoveResult>;
}
const unavailable = (): MoveResult => ({ ok: false, code: 'unavailable', message: 'Verplaatsen is niet bevestigd. Vernieuw de agenda voordat je opnieuw probeert.' });
export async function routePreparedMove(apt: MoveAppointment, target: MoveTarget, deps: MoveClientDeps): Promise<MoveResult> {
  if (deps.mode === 'legacy') return deps.legacy(apt, target);
  const invoke = deps.invoke;
  if (deps.mode !== 'atomic' || !invoke) return unavailable();
  const result = await guardedMove(apt, target, { enabled: true, rpc: async (_name, args) => {
    const response = await invoke({ appointment_id: apt.id, date: target.date, time: target.time, employee_id: target.employeeId, expected_updated_at: String(args._expected_updated_at) });
    if (response.status !== 200 || response.data.appointment_id !== apt.id) return { data: { ok: false, code: response.data.code }, error: null };
    if (!response.data.updated_at || !Number.isFinite(Date.parse(response.data.updated_at))) return { data: null, error: null };
    return { data: response.data, error: null };
  } });
  if (!result.ok && (result.code === 'unavailable' || result.code === 'failed')) return unavailable();
  return result;
}
