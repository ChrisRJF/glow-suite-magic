// PREPARED ONLY. No active entrypoint imports this module.
// Orchestrates LIVE ISV create behind the proposed reservation RPCs
// (docs/proposed-migrations/2026-10-16_isv_create_reservations.sql).
// Rule: once 'dispatching' is persisted, a second external POST is never made automatically.

export type ResState = "reserved" | "dispatching" | "completed" | "reconciliation_required";
export interface ClaimRow { state: ResState; attempt_id: string; provider_account_id: string | null; invitation_url: string | null }

export interface ReservationStore {
  claim(user: string, isDemo: boolean, attempt: string): Promise<ClaimRow | null>;
  markDispatching(user: string, isDemo: boolean, attempt: string): Promise<boolean>;
  complete(user: string, isDemo: boolean, attempt: string, accountId: string, inviteUrl: string): Promise<boolean>;
  hold(user: string, isDemo: boolean, attempt: string): Promise<boolean>;
  release(user: string, isDemo: boolean, attempt: string): Promise<boolean>;
}

export type ProviderOutcome =
  | { kind: "created"; accountId: string; redirectUrl: string }
  | { kind: "rejected" } // definite provider refusal, no account created
  | { kind: "ambiguous" }; // timeout, network error, 5xx, unparseable

export type CreateResult =
  | { status: "created" | "reused"; accountId: string; redirectUrl: string; persisted: boolean }
  | { status: "busy" | "reconciliation_required" | "rejected" | "unavailable" };

export async function reservedCreate(i: {
  sessionUserId: string | null; rowUserId: string; isDemo: boolean; attemptId: string;
  store: ReservationStore; post: () => Promise<ProviderOutcome>;
  persistMerchant: (accountId: string, redirectUrl: string) => Promise<boolean>;
}): Promise<CreateResult> {
  const { rowUserId: u, isDemo: d, attemptId: a, store } = i;
  if (!i.sessionUserId || i.sessionUserId !== u) return { status: "unavailable" };
  const persist = async (acc: string, url: string) => { try { return await i.persistMerchant(acc, url); } catch { return false; } };

  let c: ClaimRow | null;
  try { c = await store.claim(u, d, a); } catch { return { status: "unavailable" }; }
  if (!c) return { status: "unavailable" };
  if (c.state === "completed") {
    if (!c.provider_account_id || !c.invitation_url) return { status: "reconciliation_required" };
    // Retry only persistence, never POST.
    return { status: "reused", accountId: c.provider_account_id, redirectUrl: c.invitation_url, persisted: await persist(c.provider_account_id, c.invitation_url) };
  }
  if (c.state === "reconciliation_required") return { status: "reconciliation_required" };
  if (c.state === "dispatching") return c.attempt_id === a ? { status: "reconciliation_required" } : { status: "busy" };
  if (c.attempt_id !== a) return { status: "busy" };

  let fenced = false;
  try { fenced = await store.markDispatching(u, d, a); } catch { fenced = false; }
  if (!fenced) return { status: "busy" }; // could not persist fence: do not POST

  let out: ProviderOutcome;
  try { out = await i.post(); } catch { out = { kind: "ambiguous" }; }

  if (out.kind === "rejected") { try { await store.release(u, d, a); } catch { /* row stays dispatching: held */ } return { status: "rejected" }; }
  if (out.kind === "ambiguous") { try { await store.hold(u, d, a); } catch { /* dispatching stays: never retried */ } return { status: "reconciliation_required" }; }

  let journaled = false;
  try { journaled = await store.complete(u, d, a, out.accountId, out.redirectUrl); } catch { journaled = false; }
  if (!journaled) { try { await store.hold(u, d, a); } catch { /* stays dispatching */ } return { status: "reconciliation_required" }; }
  return { status: "created", accountId: out.accountId, redirectUrl: out.redirectUrl, persisted: await persist(out.accountId, out.redirectUrl) };
}
