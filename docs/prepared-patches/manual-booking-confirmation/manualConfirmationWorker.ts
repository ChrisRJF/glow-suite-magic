// INACTIVE prepared worker: sends pending rows from public.manual_confirmation_outbox.
// Not imported by src/ or any Edge Function entrypoint. Pure: claim, finish and all reads/sends are injected.
// Future home: a scheduled service_role Edge Function. No browser can trigger a send for another salon:
// the outbox row is only written by the database in the same transaction as the appointment.

import { sendForTenant, type Deps, type SkipReason } from "./manualConfirmationCore";

export interface OutboxRow { appointment_id: string; tenant_id: string; attempts: number }

export interface WorkerDeps {
  claim: (limit: number, leaseSeconds: number) => Promise<OutboxRow[]>;
  finish: (appointmentId: string, attempt: number, outcome: "sent" | "skipped" | "retry", reason: string) => Promise<boolean>;
  /** Salon live/demo state read on the server for the outbox tenant. */
  tenantIsDemo: (tenantId: string) => Promise<boolean | null>;
  core: Omit<Deps, "verifyUser" | "tenantForUser" | "rolesForUser" | "claim" | "release">;
}

/** Temporary failures are retried (same provider idempotency key); everything else is final. */
const RETRY: ReadonlySet<SkipReason> = new Set(["send_failed", "paused"]);

export async function processOutbox(deps: WorkerDeps, limit = 10): Promise<{ sent: number; skipped: number; retry: number }> {
  const out = { sent: 0, skipped: 0, retry: 0 };
  let rows: OutboxRow[] = [];
  try { rows = await deps.claim(limit, 120); } catch { return out; }
  for (const row of rows) {
    let outcome: "sent" | "skipped" | "retry"; let reason: string;
    try {
      const isDemo = await deps.tenantIsDemo(row.tenant_id);
      if (isDemo === null) { outcome = "retry"; reason = "tenant_unreadable"; }
      else {
        const r = await sendForTenant({ tenantId: row.tenant_id, isDemo }, row.appointment_id, {
          ...deps.core,
          // The outbox row IS the claim (primary key + lease); provider dedup via the same idempotency key.
          claim: async () => true, release: async () => {},
        });
        if (r.sent) { outcome = "sent"; reason = "sent"; }
        else { outcome = RETRY.has(r.reason) ? "retry" : "skipped"; reason = r.reason; }
      }
    } catch { outcome = "retry"; reason = "worker_error"; }
    await deps.finish(row.appointment_id, row.attempts, outcome, reason).catch(() => false);
    out[outcome] += 1;
  }
  return out;
}
