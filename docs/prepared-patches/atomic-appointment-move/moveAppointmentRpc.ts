// INACTIVE prepared adapter (fase 2). Not imported anywhere. Copy to src/lib/ only after
// the migration is approved and applied, and activation is approved separately.
// The only write path for a move is the RPC. No legacy fallback exists in this file.

import { supabase } from "@/integrations/supabase/client";
import { guardedMove, type MoveAppointment, type MoveTarget, type MoveResult } from "./moveAppointmentCore";

export * from "./moveAppointmentCore";

export function moveAppointmentAtomic(apt: MoveAppointment, target: MoveTarget, enabled: boolean): Promise<MoveResult> {
  return guardedMove(apt, target, {
    enabled,
    rpc: async (name, args) => {
      const { data, error, status } = await (supabase.rpc as any)(name, args);
      return { data, error: error ? { code: error.code, message: error.message, status } : null };
    },
  });
}
