// PREPARED, NOT ACTIVE. Not imported by any entrypoint.
// Fail-closed rules for Viva ISV merchant onboarding (create, sync, webhook, payment gate).
//
// Verified against developer.viva.com (2026-10-15):
//  - Create a connected account: POST /isv/v1/accounts -> { accountId, redirectUrl }.
//  - Retrieve connected account: GET /isv/v1/accounts/{accountId} (returns Merchant ID + verification).
//  - Webhooks 8193 Account Connected / 8194 Account Verification Status Changed carry
//    EventData.ConnectedAccountId, PersonId (= Merchant ID) and, for 8194, Verified (bool).
//  - 8194 is Production only (not delivered in Demo).
//  - ISV webhook POSTs carry NO documented signature; only the GET verification key exists.
// UNVERIFIED (API reference not machine-readable): exact JSON field names of the
// Retrieve response. Parsing below accepts only explicit fields and fails closed otherwise.

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const ISV_HOSTS = {
  demo: "https://demo-api.vivapayments.com",
  live: "https://api.vivapayments.com",
} as const;

export interface AuthoritativeAccount {
  accountId: string;
  merchantId: string | null;
  verified: boolean | null; // null = unknown -> treated as not verified
}

const UUIDISH = /^[0-9a-fA-F-]{8,64}$/;

/** Parse Retrieve response strictly. Unknown shape -> null (fail closed). */
export function parseRetrieve(accountId: string, body: unknown): AuthoritativeAccount | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const id = String(b.accountId ?? b.AccountId ?? "");
  if (id && id !== accountId) return null; // response for a different account
  const mid = b.merchantId ?? b.MerchantId ?? null;
  const merchantId = typeof mid === "string" && UUIDISH.test(mid) ? mid : null;
  const v = b.verified ?? b.Verified ?? b.isVerified ?? null;
  return { accountId, merchantId, verified: typeof v === "boolean" ? v : null };
}

/** Fetch authoritative account with ISV token only. Any failure -> null. */
export async function retrieveAccount(
  accountId: string, env: "demo" | "live", isvToken: string | null, fetchFn: Fetch,
): Promise<AuthoritativeAccount | null> {
  if (!isvToken || !UUIDISH.test(accountId)) return null;
  try {
    const r = await fetchFn(`${ISV_HOSTS[env]}/isv/v1/accounts/${encodeURIComponent(accountId)}`, {
      headers: { Authorization: `Bearer ${isvToken}` },
    });
    if (!r.ok) return null;
    return parseRetrieve(accountId, await r.json().catch(() => null));
  } catch { return null; }
}

export interface MerchantRow {
  id: string;
  user_id: string;
  is_demo: boolean;
  viva_account_id: string | null;
  viva_merchant_id: string | null;
  viva_source_code: string | null;
  onboarding_status: string | null;
  kyc_status: string | null;
  onboarding_url?: string | null;
}

/** Status update derived ONLY from the authoritative account. Never from webhook body. */
export function deriveUpdate(row: MerchantRow, acc: AuthoritativeAccount): Record<string, unknown> | null {
  if (!row.viva_account_id || row.viva_account_id !== acc.accountId) return null;
  if (row.viva_merchant_id && acc.merchantId && row.viva_merchant_id !== acc.merchantId) return null; // never rebind
  const upd: Record<string, unknown> = { last_synced_at: new Date().toISOString() };
  if (acc.merchantId) upd.viva_merchant_id = acc.merchantId;
  if (acc.verified === true) { upd.kyc_status = "verified"; upd.onboarding_status = "active"; }
  else if (acc.merchantId) { upd.kyc_status = "pending"; upd.onboarding_status = "kyc_pending"; }
  else { upd.onboarding_status = row.onboarding_status === "not_started" ? "invited" : (row.onboarding_status ?? "invited"); }
  // A previously active account that is no longer verified must drop out of live.
  if (acc.verified === false && row.onboarding_status === "active") { upd.onboarding_status = "kyc_pending"; upd.kyc_status = "pending"; }
  return upd; // viva_source_code is intentionally never set here.
}

// ---------------- Webhook 8193 / 8194 ----------------
export interface WebhookDeps {
  env: "demo" | "live";
  getIsvToken(): Promise<string | null>;
  fetchFn: Fetch;
  /** insert dedupe row keyed by MessageId; returns "inserted" | "duplicate" | "error" */
  recordEvent(key: string, typeId: number): Promise<"inserted" | "duplicate" | "error">;
  findByAccountId(accountId: string): Promise<MerchantRow | null | "error">;
  update(rowId: string, expectedUserId: string, upd: Record<string, unknown>): Promise<boolean>;
}

export type WebhookOutcome = { status: number; result: string };

export async function handleOnboardingWebhook(raw: string, d: WebhookDeps): Promise<WebhookOutcome> {
  let p: any; try { p = JSON.parse(raw); } catch { return { status: 200, result: "ignored_invalid" }; }
  const typeId = Number(p?.EventTypeId);
  if (typeId !== 8193 && typeId !== 8194) return { status: 200, result: "ignored_type" };
  const accountId = String(p?.EventData?.ConnectedAccountId ?? "");
  const msgId = String(p?.MessageId ?? "");
  if (!UUIDISH.test(accountId) || !msgId) return { status: 200, result: "ignored_invalid" };

  const rec = await d.recordEvent(`isvacct:${d.env}:${msgId}`, typeId);
  if (rec === "error") return { status: 503, result: "retry_storage" };
  if (rec === "duplicate") return { status: 200, result: "duplicate" };

  const row = await d.findByAccountId(accountId);
  if (row === "error") return { status: 503, result: "retry_lookup" };
  if (!row) return { status: 200, result: "unknown_account" }; // never create/bind from webhook
  if (row.is_demo !== (d.env === "demo")) return { status: 200, result: "env_mismatch" };

  // Body is only a hint: authority comes from Viva Retrieve with ISV credentials.
  const acc = await retrieveAccount(accountId, d.env, await d.getIsvToken(), d.fetchFn);
  if (!acc) return { status: 503, result: "retry_viva_unavailable" };
  const upd = deriveUpdate(row, acc);
  if (!upd) return { status: 200, result: "rejected_mismatch" };
  const ok = await d.update(row.id, row.user_id, upd);
  return ok ? { status: 200, result: "updated" } : { status: 503, result: "retry_update" };
}

// ---------------- Sync (session-scoped) ----------------
export async function syncForSession(
  sessionUserId: string | null,
  _body: unknown, // user_id / viva_account_id in body are deliberately ignored
  d: Omit<WebhookDeps, "recordEvent" | "findByAccountId"> & { findByUser(userId: string, isDemo: boolean): Promise<MerchantRow | null | "error"> },
): Promise<{ status: number; result: string }> {
  if (!sessionUserId) return { status: 401, result: "unauthorized" };
  const row = await d.findByUser(sessionUserId, d.env === "demo");
  if (row === "error") return { status: 503, result: "unavailable" };
  if (!row || !row.viva_account_id) return { status: 404, result: "not_connected" };
  const acc = await retrieveAccount(row.viva_account_id, d.env, await d.getIsvToken(), d.fetchFn);
  if (!acc) return { status: 503, result: "viva_unavailable" }; // nothing changed
  const upd = deriveUpdate(row, acc);
  if (!upd) return { status: 409, result: "rejected_mismatch" };
  return (await d.update(row.id, sessionUserId, upd)) ? { status: 200, result: "updated" } : { status: 503, result: "unavailable" };
}

// ---------------- Live payment gate ----------------
export function livePaymentAllowed(m: MerchantRow | null): { ok: boolean; reason: string } {
  if (!m) return { ok: false, reason: "not_connected" };
  if (m.is_demo) return { ok: false, reason: "demo_account" };
  if (String(m.onboarding_status).toLowerCase() !== "active") return { ok: false, reason: "not_active" };
  if (String(m.kyc_status).toLowerCase() !== "verified") return { ok: false, reason: "kyc_not_verified" };
  if (!m.viva_merchant_id) return { ok: false, reason: "merchant_id_missing" };
  if (!(m.viva_source_code || "").trim()) return { ok: false, reason: "source_code_missing" };
  return { ok: true, reason: "ok" };
}

// ---------------- Idempotent create ----------------
export type CreateDecision =
  | { action: "reuse"; redirectUrl: string | null }
  | { action: "create" }
  | { action: "refuse"; reason: string };

export function decideCreate(existing: MerchantRow | null, opts: { reconnect?: boolean } = {}): CreateDecision {
  if (!existing || !existing.viva_account_id) return { action: "create" };
  const s = String(existing.onboarding_status).toLowerCase();
  if (s === "active" || s === "kyc_pending" || s === "connected") return { action: "refuse", reason: "already_connected" };
  if (opts.reconnect && (s === "rejected" || s === "suspended")) return { action: "refuse", reason: "manual_review_required" };
  return { action: "reuse", redirectUrl: existing.onboarding_url ?? null };
}

/** Parse Create response per verified contract: accountId + redirectUrl. */
export function parseCreate(body: unknown): { accountId: string; redirectUrl: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const redirectUrl = typeof b.redirectUrl === "string" ? b.redirectUrl : "";
  if (!UUIDISH.test(accountId) || !/^https:\/\/[^\s]+$/.test(redirectUrl)) return null;
  return { accountId, redirectUrl };
}
