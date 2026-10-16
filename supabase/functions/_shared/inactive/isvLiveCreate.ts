// LIVE ISV create orchestration (imported only by create-viva-connected-account).
// Default off: VIVA_ISV_LIVE_ENABLED !== "true" returns before any DB, token or Viva call.
import { loadLiveIsvConfig, getLiveIsvToken, LIVE_ISV_API_HOST, type EnvGet } from "./isvLiveConfig.ts";
import { buildCreatePayload, parseCreateV2, safeInvitationUrl } from "./isvOnboardingV2.ts";
import { glowPayVivaBranding } from "./isvGlowPayBranding.ts";
import { reservedCreate, type ReservationStore, type ProviderOutcome } from "./isvCreateReservation.ts";

export const LIVE_RETURN_URL = "https://glowsuite.nl/glowpay/registratie-status";
type Fetch = typeof fetch;
export interface LiveMerchantRow { id: string; user_id: string; is_demo: boolean; viva_account_id: string | null; onboarding_url: string | null }

export interface LiveCreateDeps {
  get: EnvGet; fetchFn: Fetch; store: ReservationStore; newAttemptId: () => string;
  findLiveRow: (uid: string) => Promise<LiveMerchantRow | null | "error">;
  /** Tenant-guarded insert/update; must never overwrite a different viva_account_id. */
  persist: (uid: string, existing: LiveMerchantRow | null, accountId: string, inviteUrl: string, email: string) => Promise<boolean>;
}

export type LiveCreateResponse =
  | { status: 200; body: { status: "created" | "reused"; onboarding_url: string } }
  | { status: 202; body: { status: "persistence_pending" | "reconciliation_required" | "busy" } }
  | { status: number; body: { error: string } };

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export async function liveCreateForSession(sessionUserId: string | null, rawEmail: unknown, d: LiveCreateDeps): Promise<LiveCreateResponse> {
  if (!sessionUserId) return { status: 401, body: { error: "unauthorized" } };
  const cfg = loadLiveIsvConfig(d.get);
  if (!cfg.ok) return { status: 503, body: { error: cfg.reason } };
  const email = String(rawEmail ?? "").trim();
  if (!EMAIL.test(email) || email.length > 254) return { status: 400, body: { error: "invalid_email" } };

  const payload = buildCreatePayload({ email, returnUrl: LIVE_RETURN_URL, branding: glowPayVivaBranding() });
  if (!payload) return { status: 400, body: { error: "invalid_email" } };
  const row = await d.findLiveRow(sessionUserId);
  if (row === "error") return { status: 503, body: { error: "unavailable" } };
  if (row && (row.user_id !== sessionUserId || row.is_demo !== false)) return { status: 403, body: { error: "tenant_mismatch" } };
  if (row?.viva_account_id) {
    const url = safeInvitationUrl(row.onboarding_url);
    return url ? { status: 200, body: { status: "reused", onboarding_url: url } } : { status: 409, body: { error: "manual_recovery_required" } };
  }

  const post = async (): Promise<ProviderOutcome> => {
    const token = await getLiveIsvToken(d.get, d.fetchFn);
    if (!token) return { kind: "ambiguous" }; // fence already set; never released without proof
    try {
      const r = await d.fetchFn(`${LIVE_ISV_API_HOST}/isv/v1/accounts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) return { kind: "ambiguous" };
      const p = parseCreateV2(await r.json().catch(() => null));
      return p ? { kind: "created", accountId: p.accountId, redirectUrl: p.redirectUrl } : { kind: "ambiguous" };
    } catch { return { kind: "ambiguous" }; }
  };

  const res = await reservedCreate({
    sessionUserId, rowUserId: sessionUserId, isDemo: false, attemptId: d.newAttemptId(), store: d.store, post,
    persistMerchant: (acc, url) => d.persist(sessionUserId, row, acc, url, email),
  });
  if (res.status === "created" || res.status === "reused") {
    const url = safeInvitationUrl(res.redirectUrl);
    return url ? { status: 200, body: { status: res.status, onboarding_url: url } } : { status: 202, body: { status: "reconciliation_required" } };
  }
  if (res.status === "persistence_pending" || res.status === "reconciliation_required" || res.status === "busy") return { status: 202, body: { status: res.status } };
  if (res.status === "rejected") return { status: 502, body: { error: "rejected" } };
  return { status: 503, body: { error: "unavailable" } };
}

/** Service-role RPC store; any error or unexpected shape fails closed. */
export function rpcReservationStore(rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>): ReservationStore {
  const bool = async (fn: string, u: string, dm: boolean, a: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await rpc(fn, { _user: u, _is_demo: dm, _attempt: a, ...extra });
    if (error || typeof data !== "boolean") throw new Error("rpc_failed");
    return data;
  };
  return {
    async claim(u, dm, a) {
      const { data, error } = await rpc("isv_create_claim", { _user: u, _is_demo: dm, _attempt: a });
      if (error) throw new Error("rpc_failed");
      const r = Array.isArray(data) ? data[0] : data as any;
      if (!r || !["reserved", "dispatching", "completed", "reconciliation_required"].includes(r.state) || typeof r.attempt_id !== "string") return null;
      return { state: r.state, attempt_id: r.attempt_id, provider_account_id: r.provider_account_id ?? null, invitation_url: r.invitation_url ?? null };
    },
    markDispatching: (u, dm, a) => bool("isv_create_mark_dispatching", u, dm, a),
    complete: (u, dm, a, acc, url) => bool("isv_create_complete", u, dm, a, { _account: acc, _invite: url }),
    hold: (u, dm, a) => bool("isv_create_hold", u, dm, a),
    release: (u, dm, a) => bool("isv_create_release", u, dm, a),
  };
}
