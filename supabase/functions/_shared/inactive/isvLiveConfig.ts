// PREPARED. Only syncLiveForSession is imported by sync-viva-connected-account (default-off switch).
// Separate LIVE Viva ISV configuration. Reads ONLY the secret NAMES below through an
// injected getter; never VIVA_ENVIRONMENT, VIVA_ISV_CLIENT_*, merchant or POS credentials.
// Every check fails closed. No network call happens unless a caller injects fetch.
import { ISV_HOSTS, type Fetch, type MerchantRow } from "./isvOnboardingSafety.ts";
import { buildCreatePayload, parseCreateV2, parseRetrieveV2, decideCreateV2, livePaymentAllowedV2, deriveUpdateV2, type Branding, type AccountV2 } from "./isvOnboardingV2.ts";

export const LIVE_ISV_SECRET_NAMES = {
  clientId: "VIVA_ISV_LIVE_CLIENT_ID",
  clientSecret: "VIVA_ISV_LIVE_CLIENT_SECRET",
  /** Not yet created. Absent or anything other than "true" = LIVE ISV off. */
  enabled: "VIVA_ISV_LIVE_ENABLED",
  /** Comma-separated auth user UUIDs. Absent/empty/any invalid entry = nobody allowed. */
  /** Key returned by GET /isv/v1/webhooks/token, echoed on GET viva-webhook?isv=1. */
  webhookVerificationKey: "VIVA_ISV_LIVE_WEBHOOK_VERIFICATION_KEY",
} as const;

export const LIVE_ISV_ACCOUNT_HOST = "https://accounts.vivapayments.com";
export const LIVE_ISV_API_HOST = ISV_HOSTS.live;

const FORBIDDEN = new Set(["VIVA_ENVIRONMENT", "VIVA_ISV_CLIENT_ID", "VIVA_ISV_CLIENT_SECRET", "VIVA_CLIENT_ID", "VIVA_CLIENT_SECRET", "VIVA_POS_CLIENT_ID", "VIVA_POS_CLIENT_SECRET", "VIVA_ISV_DEMO_ENABLED"]);
export type EnvGet = (name: string) => string | undefined;

/** Getter that can only see the LIVE ISV names, so mixing with demo/merchant config is impossible. */
export function scopedEnv(get: EnvGet): EnvGet {
  const allowed = new Set<string>(Object.values(LIVE_ISV_SECRET_NAMES));
  return (n) => (allowed.has(n) && !FORBIDDEN.has(n) ? get(n) : undefined);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/** Webhook verification key only when the LIVE switch is on and a key is configured. */
export function liveWebhookVerificationKey(rawGet: EnvGet): string | null {
  const get = scopedEnv(rawGet);
  if ((get(LIVE_ISV_SECRET_NAMES.enabled) ?? "").trim() !== "true") return null;
  const k = (get(LIVE_ISV_SECRET_NAMES.webhookVerificationKey) ?? "").trim();
  return k || null;
}

export type LiveConfig =
  | { ok: true; clientId: string; clientSecret: string }
  | { ok: false; reason: "live_isv_disabled" | "live_isv_credentials_missing" };

export function loadLiveIsvConfig(rawGet: EnvGet): LiveConfig {
  const get = scopedEnv(rawGet);
  if ((get(LIVE_ISV_SECRET_NAMES.enabled) ?? "").trim() !== "true") return { ok: false, reason: "live_isv_disabled" };
  const clientId = (get(LIVE_ISV_SECRET_NAMES.clientId) ?? "").trim();
  const clientSecret = (get(LIVE_ISV_SECRET_NAMES.clientSecret) ?? "").trim();
  if (!clientId || !clientSecret) return { ok: false, reason: "live_isv_credentials_missing" };
  return { ok: true, clientId, clientSecret };
}

/** Safe status for health output: presence booleans only, never values or fragments. */
export function liveIsvStatus(rawGet: EnvGet) {
  const get = scopedEnv(rawGet);
  const c = loadLiveIsvConfig(rawGet);
  return {
    live_isv_enabled: (get(LIVE_ISV_SECRET_NAMES.enabled) ?? "").trim() === "true",
    live_isv_client_id_present: Boolean((get(LIVE_ISV_SECRET_NAMES.clientId) ?? "").trim()),
    live_isv_client_secret_present: Boolean((get(LIVE_ISV_SECRET_NAMES.clientSecret) ?? "").trim()),
    ready: c.ok,
    reason: c.ok ? "ok" : c.reason,
  };
}

/** OAuth2 client credentials token for LIVE ISV. Any failure -> null, error text never surfaced. */
export async function getLiveIsvToken(rawGet: EnvGet, f: Fetch): Promise<string | null> {
  const c = loadLiveIsvConfig(rawGet);
  if (!c.ok) return null;
  try {
    const r = await f(`${LIVE_ISV_ACCOUNT_HOST}/connect/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${c.clientId}:${c.clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!r.ok) return null;
    const b = await r.json().catch(() => null) as any;
    return typeof b?.access_token === "string" && b.access_token ? b.access_token : null;
  } catch { return null; }
}

export type LiveCreateResult =
  | { ok: true; action: "created"; accountId: string; redirectUrl: string }
  | { ok: true; action: "reuse"; redirectUrl: string }
  | { ok: false; reason: string };

/** Idempotent LIVE create. Refuses before any call when row/payload/config is unsafe. */
export async function createLiveAccount(
  sessionUserId: string | null,
  row: MerchantRow | null,
  input: { email: string; returnUrl: string; branding: Branding },
  rawGet: EnvGet, f: Fetch,
): Promise<LiveCreateResult> {
  if (!sessionUserId) return { ok: false, reason: "unauthorized" };
  if (row && row.user_id !== sessionUserId) return { ok: false, reason: "tenant_mismatch" };
  const config = loadLiveIsvConfig(rawGet);
  if (!config.ok) return { ok: false, reason: config.reason };
  const step = decideCreateV2(row, "live");
  if (step.action === "refuse") return { ok: false, reason: step.reason };
  if (step.action === "reuse") return { ok: true, action: "reuse", redirectUrl: step.redirectUrl };
  if (step.action === "refresh_invite") return { ok: false, reason: "refresh_via_retrieve" };
  const payload = buildCreatePayload(input);
  if (!payload) return { ok: false, reason: "invalid_payload" };
  const token = await getLiveIsvToken(rawGet, f);
  if (!token) return { ok: false, reason: "live_isv_token_unavailable" };
  try {
    const r = await f(`${LIVE_ISV_API_HOST}/isv/v1/accounts`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!r.ok) return { ok: false, reason: "viva_create_failed" };
    const p = parseCreateV2(await r.json().catch(() => null));
    return p ? { ok: true, action: "created", ...p } : { ok: false, reason: "viva_create_unparseable" };
  } catch { return { ok: false, reason: "viva_create_failed" }; }
}

/** Low-level parser adapter. Only call with an ID obtained from a session-scoped row. */
async function retrieveLiveAccount(accountId: string, rawGet: EnvGet, f: Fetch): Promise<AccountV2 | null> {
  if (!/^[0-9a-fA-F-]{8,64}$/.test(accountId)) return null;
  const token = await getLiveIsvToken(rawGet, f);
  if (!token) return null;
  try {
    const r = await f(`${LIVE_ISV_API_HOST}/isv/v1/accounts/${encodeURIComponent(accountId)}`, { headers: { Authorization: `Bearer ${token}` } });
    return r.ok ? parseRetrieveV2(accountId, await r.json().catch(() => null)) : null;
  } catch { return null; }
}

/** LIVE payment readiness: config on + authoritative Retrieve + V2 gate (incl. source code). */
export async function liveAccountStatus(sessionUserId: string | null, row: MerchantRow | null, rawGet: EnvGet, f: Fetch) {
  if (!sessionUserId) return { ok: false, reason: "unauthorized" };
  if (row && row.user_id !== sessionUserId) return { ok: false, reason: "tenant_mismatch" };
  const c = loadLiveIsvConfig(rawGet);
  if (!c.ok) return { ok: false, reason: c.reason };
  if (!row?.viva_account_id) return { ok: false, reason: "not_connected" };
  if (row.is_demo) return { ok: false, reason: "not_live_env" };
  const a = await retrieveLiveAccount(row.viva_account_id, rawGet, f);
  return livePaymentAllowedV2(row, a, "live");
}
export interface LiveSyncDeps {
  get: EnvGet;
  fetchFn: Fetch;
  /** Must select by session user_id AND is_demo=false only. "error" = storage unavailable. */
  findLiveRowByUser(userId: string): Promise<MerchantRow | null | "error">;
  /** Must update scoped by row id AND user_id. */
  update(rowId: string, userId: string, upd: Record<string, unknown>): Promise<boolean>;
}

/** Tenant-authenticated LIVE sync. Config is checked before any read; Retrieve decides; nothing written on failure. */
export async function syncLiveForSession(sessionUserId: string | null, d: LiveSyncDeps): Promise<{ status: number; result: string }> {
  if (!sessionUserId) return { status: 401, result: "unauthorized" };
  const c = loadLiveIsvConfig(d.get);
  if (!c.ok) return { status: 503, result: c.reason };
  const row = await d.findLiveRowByUser(sessionUserId);
  if (row === "error") return { status: 503, result: "unavailable" };
  if (!row || !row.viva_account_id) return { status: 404, result: "not_connected" };
  if (row.user_id !== sessionUserId) return { status: 403, result: "tenant_mismatch" };
  if (row.is_demo) return { status: 409, result: "not_live_env" };
  const a = await retrieveLiveAccount(row.viva_account_id, d.get, d.fetchFn);
  if (!a) return { status: 503, result: "viva_unavailable" };
  const upd = deriveUpdateV2(row, a);
  if (!upd) return { status: 409, result: "rejected_mismatch" };
  return (await d.update(row.id, sessionUserId, upd)) ? { status: 200, result: "updated" } : { status: 503, result: "unavailable" };
}
