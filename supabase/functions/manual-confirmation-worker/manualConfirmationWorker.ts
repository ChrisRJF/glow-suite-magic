// INACTIVE prepared worker: sends pending rows from public.manual_confirmation_outbox.
// Not imported by src/ or any Edge Function entrypoint. Pure: claim, finish and all reads/sends are injected.
// Future home: scheduled service_role Edge Function (see worker-entrypoint/index.ts).
//
// Test-phase scope is enforced on the server, twice:
//   1) claim is per tenant (claim_manual_confirmations_for_tenant): rows of other salons are never
//      fetched, leased or counted.
//   2) a row whose tenant is not on the allow-list is never sent and never finished (left untouched).
// Recipients: core allowedRecipients (exact lowercased addresses; empty = nobody).
//
// Outcomes:
//   sent    confirmed provider success only
//   skipped final, real reason (opt-out, demo, cancelled, wrong recipient, invalid appointment, ...)
//   retry   definite send failure; counts towards the 5-attempt limit, same idempotency key
//   defer   temporary/technical (stop switch on, settings/consent/salon unreadable, worker error);
//           does NOT consume an attempt, so a paused or unreadable period never drops a request
//   hold    provider outcome unknown; not marked sent, not auto-resent, kept for manual review
// Exactly-once delivery is NOT proven: it depends on the provider honouring the Idempotency-Key.

import { sendForTenant, type Deps, type SkipReason } from "./manualConfirmationCore.ts";

export interface OutboxRow { appointment_id: string; tenant_id: string; attempts: number }
export type Outcome = "sent" | "skipped" | "retry" | "defer" | "hold";

export interface WorkerDeps {
  /** Per-tenant claim; must never return rows of another tenant. */
  claim: (tenantId: string, limit: number, leaseSeconds: number) => Promise<OutboxRow[]>;
  finish: (appointmentId: string, attempt: number, outcome: Outcome, reason: string) => Promise<boolean>;
  /** Salon live/demo state read on the server for the outbox tenant. null = unreadable. */
  tenantIsDemo: (tenantId: string) => Promise<boolean | null>;
  /** Test phase: exact tenant ids allowed to be processed. Empty = process nothing. */
  allowedTenants: ReadonlySet<string>;
  core: Omit<Deps, "verifyUser" | "tenantForUser" | "rolesForUser" | "claim" | "release">;
}

const RETRY: ReadonlySet<SkipReason> = new Set(["send_failed"]);
const DEFER: ReadonlySet<SkipReason> = new Set(["paused", "consent_unreadable", "controls_unreadable"]);
const HOLD: ReadonlySet<SkipReason> = new Set(["send_uncertain"]);

export function classify(reason: SkipReason): Outcome {
  if (RETRY.has(reason)) return "retry";
  if (DEFER.has(reason)) return "defer";
  if (HOLD.has(reason)) return "hold";
  return "skipped";
}

export type Summary = Record<Outcome, number> & { untouched: number };

export async function processOutbox(deps: WorkerDeps, limit = 10): Promise<Summary> {
  const out: Summary = { sent: 0, skipped: 0, retry: 0, defer: 0, hold: 0, untouched: 0 };
  for (const tenantId of deps.allowedTenants) {
    let rows: OutboxRow[] = [];
    try { rows = await deps.claim(tenantId, limit, 120); } catch { continue; }
    for (const row of rows) {
      // Defence in depth: never act on another salon's row, not even to finish it.
      if (row.tenant_id !== tenantId || !deps.allowedTenants.has(row.tenant_id)) { out.untouched += 1; continue; }
      let outcome: Outcome; let reason: string;
      try {
        const isDemo = await deps.tenantIsDemo(row.tenant_id);
        if (isDemo === null) { outcome = "defer"; reason = "tenant_unreadable"; }
        else {
          const r = await sendForTenant({ tenantId: row.tenant_id, isDemo }, row.appointment_id, {
            ...deps.core,
            // The outbox row IS the claim (primary key + lease); provider dedup via the same idempotency key.
            claim: async () => true, release: async () => {},
          });
          if (r.sent) { outcome = "sent"; reason = "sent"; }
          else { outcome = classify(r.reason); reason = r.reason; }
        }
      } catch { outcome = "defer"; reason = "worker_error"; }
      await deps.finish(row.appointment_id, row.attempts, outcome, reason).catch(() => false);
      out[outcome] += 1;
    }
  }
  return out;
}

/** Maps a send-white-label-email HTTP reply. Only an explicit 200 + success:true is a success. */
export function interpretSenderReply(status: number, body: unknown): { ok: boolean; uncertain?: boolean } {
  const b = (body ?? {}) as { success?: unknown };
  if (status === 200 && b.success === true) return { ok: true };
  if (status === 200) return { ok: false, uncertain: true };      // 200 without confirmation
  if (status >= 400 && status < 500) return { ok: false };         // refused before sending
  if (status === 502) return { ok: false };                        // provider answered "not ok"
  return { ok: false, uncertain: true };                           // 500/503/504/other: may have left
}
