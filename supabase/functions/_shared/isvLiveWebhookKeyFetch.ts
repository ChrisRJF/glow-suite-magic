// Admin-only retrieval of the LIVE Viva ISV webhook verification key.
// Uses ONLY VIVA_ISV_LIVE_CLIENT_ID/SECRET (never demo/merchant/VIVA_ENVIRONMENT).
// Deliberately independent of VIVA_ISV_LIVE_ENABLED: the key must exist before LIVE is switched on.
// Never logs the key; caller returns it only to an authenticated AAL2 platform admin.
import { LIVE_ISV_ACCOUNT_HOST, LIVE_ISV_API_HOST, LIVE_ISV_SECRET_NAMES, scopedEnv, type EnvGet } from "./inactive/isvLiveConfig.ts";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fail-closed: absent/empty/any invalid entry in PLATFORM_ADMIN_USER_IDS = nobody. */
export function isPlatformAdmin(userId: string | null | undefined, adminIdsRaw: string | undefined): boolean {
  if (!userId || !UUID.test(userId)) return false;
  const ids = (adminIdsRaw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length || ids.some((s) => !UUID.test(s))) return false;
  return ids.some((s) => s.toLowerCase() === userId.toLowerCase());
}

export type KeyResult = { status: number; body: { key?: string; error?: string } };

export async function fetchLiveWebhookKeyForAdmin(
  auth: { userId: string | null; aal: string | null; confirmed: boolean },
  adminIdsRaw: string | undefined,
  rawGet: EnvGet,
  f: Fetch,
): Promise<KeyResult> {
  if (!auth.userId) return { status: 401, body: { error: "unauthorized" } };
  if (!isPlatformAdmin(auth.userId, adminIdsRaw)) return { status: 403, body: { error: "forbidden" } };
  if (auth.aal !== "aal2") return { status: 403, body: { error: "mfa_required" } };
  if (!auth.confirmed) return { status: 400, body: { error: "confirmation_required" } };
  const r = await fetchLiveIsvWebhookKey(rawGet, f);
  return r.ok ? { status: 200, body: { key: r.key } } : { status: r.status, body: { error: r.error } };
}

type Fetched = { ok: true; key: string } | { ok: false; status: number; error: string };

/** Core: LIVE OAuth token -> GET /isv/v1/webhooks/token. LIVE secrets only; errors never carry provider text. */
export async function fetchLiveIsvWebhookKey(rawGet: EnvGet, f: Fetch): Promise<Fetched> {
  const get = scopedEnv(rawGet);
  const id = (get(LIVE_ISV_SECRET_NAMES.clientId) ?? "").trim();
  const secret = (get(LIVE_ISV_SECRET_NAMES.clientSecret) ?? "").trim();
  if (!id || !secret) return { ok: false, status: 503, error: "live_isv_credentials_missing" };
  try {
    const t = await f(`${LIVE_ISV_ACCOUNT_HOST}/connect/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const tj: any = await t.json().catch(() => null);
    if (!t.ok || typeof tj?.access_token !== "string" || !tj.access_token) return { ok: false, status: 502, error: "token_unavailable" };
    const r = await f(`${LIVE_ISV_API_HOST}/isv/v1/webhooks/token`, { headers: { Authorization: `Bearer ${tj.access_token}` } });
    const rj: any = await r.json().catch(() => null);
    const key = typeof rj?.key === "string" ? rj.key.trim() : "";
    if (!r.ok || !key) return { ok: false, status: 502, error: "key_unavailable" };
    return { ok: true, key };
  } catch {
    return { ok: false, status: 502, error: "viva_unavailable" };
  }
}

let cached: { key: string; at: number } | null = null;
let inflight: Promise<string | null> | null = null;
const TTL_MS = 10 * 60 * 1000;

/**
 * Public ISV verification answer for viva-webhook GET ?isv=1.
 * Off unless VIVA_ISV_LIVE_ENABLED === "true". Stored key wins; otherwise fetched on demand,
 * cached per isolate and single-flight to bound outbound calls from unauthenticated GETs.
 */
export async function resolveLiveVerificationKey(rawGet: EnvGet, f: Fetch, now = Date.now()): Promise<string | null> {
  const get = scopedEnv(rawGet);
  if ((get(LIVE_ISV_SECRET_NAMES.enabled) ?? "").trim() !== "true") return null;
  const stored = (get(LIVE_ISV_SECRET_NAMES.webhookVerificationKey) ?? "").trim();
  if (stored) return stored;
  if (cached && now - cached.at < TTL_MS) return cached.key;
  if (!inflight) {
    inflight = fetchLiveIsvWebhookKey(rawGet, f)
      .then((r) => { if (r.ok) { cached = { key: r.key, at: now }; return r.key; } return null; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Test-only reset. */
export function _resetLiveKeyCache() { cached = null; inflight = null; }
