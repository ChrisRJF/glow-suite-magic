// PREPARED, NOT ACTIVE. Not imported by any entrypoint.
// Separate LIVE Viva ISV configuration. Reads ONLY the secret NAMES below through an
// injected getter; never VIVA_ENVIRONMENT, VIVA_ISV_CLIENT_*, merchant or POS credentials.
// Every check fails closed. No network call happens unless a caller injects fetch.
import { ISV_HOSTS, type Fetch, type MerchantRow } from "./isvOnboardingSafety.ts";
import { buildCreatePayload, parseCreateV2, parseRetrieveV2, decideCreateV2, livePaymentAllowedV2, type Branding, type AccountV2 } from "./isvOnboardingV2.ts";

export const LIVE_ISV_SECRET_NAMES = {
  clientId: "VIVA_ISV_LIVE_CLIENT_ID",
  clientSecret: "VIVA_ISV_LIVE_CLIENT_SECRET",
  /** Not yet created. Absent or anything other than "true" = LIVE ISV off. */
  enabled: "VIVA_ISV_LIVE_ENABLED",
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
  row: MerchantRow | null,
  input: { email: string; returnUrl: string; branding: Branding },
  rawGet: EnvGet, f: Fetch,
): Promise<LiveCreateResult> {
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

export async function retrieveLiveAccount(accountId: string, rawGet: EnvGet, f: Fetch): Promise<AccountV2 | null> {
  if (!/^[0-9a-fA-F-]{8,64}$/.test(accountId)) return null;
  const token = await getLiveIsvToken(rawGet, f);
  if (!token) return null;
  try {
    const r = await f(`${LIVE_ISV_API_HOST}/isv/v1/accounts/${encodeURIComponent(accountId)}`, { headers: { Authorization: `Bearer ${token}` } });
    return r.ok ? parseRetrieveV2(accountId, await r.json().catch(() => null)) : null;
  } catch { return null; }
}

/** LIVE payment readiness: config on + authoritative Retrieve + V2 gate (incl. source code). */
export async function liveAccountStatus(row: MerchantRow | null, rawGet: EnvGet, f: Fetch) {
  const c = loadLiveIsvConfig(rawGet);
  if (!c.ok) return { ok: false, reason: c.reason };
  if (!row?.viva_account_id) return { ok: false, reason: "not_connected" };
  if (row.is_demo) return { ok: false, reason: "not_live_env" };
  const a = await retrieveLiveAccount(row.viva_account_id, rawGet, f);
  return livePaymentAllowedV2(row, a, "live");
}