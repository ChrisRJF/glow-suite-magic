// Fixed LIVE ISV registration. Contract supplied by owner from official Viva docs.
import { LIVE_ISV_API_HOST, loadLiveIsvConfig, getLiveIsvToken, type EnvGet } from "./inactive/isvLiveConfig.ts";
import { isPlatformAdmin } from "./isvLiveWebhookKeyFetch.ts";
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export const ISV_WEBHOOK_URL = "https://ueqhckkuuwdsrjrdczbb.supabase.co/functions/v1/viva-webhook?isv=1";
export const ISV_EVENT_TYPES = [1796, 1797, 1798, 8193, 8194] as const;
export const CONFIRM_WORD = "register_live_isv_webhooks_1796_1797_1798_8193_8194";
type EventResult = { status: "registered" | "failed" | "unknown"; httpStatus: number | null; at: string };
export type RegisterResult = { status: number; body: { error?: string; events?: Record<string, EventResult> } };
export async function registerLiveIsvWebhooksForAdmin(
  auth: { userId: string | null; aal: string | null; confirmed: boolean },
  adminIdsRaw: string | undefined, rawGet: EnvGet, f: Fetch,
): Promise<RegisterResult> {
  if (!auth.userId) return { status: 401, body: { error: "unauthorized" } };
  if (!isPlatformAdmin(auth.userId, adminIdsRaw)) return { status: 403, body: { error: "forbidden" } };
  if (auth.aal !== "aal2") return { status: 403, body: { error: "mfa_required" } };
  if (!auth.confirmed) return { status: 400, body: { error: "confirmation_required" } };
  const config = loadLiveIsvConfig(rawGet);
  if (!config.ok) return { status: 503, body: { error: config.reason } };
  const token = await getLiveIsvToken(rawGet, f);
  if (!token) return { status: 502, body: { error: "live_isv_token_unavailable" } };
  // Endpoint ownership, not POST authentication. Keys/provider bodies never returned or logged.
  try {
    const kr = await f(`${LIVE_ISV_API_HOST}/isv/v1/webhooks/token`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000), redirect: "error",
    });
    const kb = await kr.json().catch(() => null);
    if (kr.status !== 200 || typeof kb?.key !== "string" || !kb.key.trim()) return { status: 502, body: { error: "verification_key_unavailable" } };
    const cr = await f(ISV_WEBHOOK_URL, { signal: AbortSignal.timeout(15000), redirect: "error" });
    const cb = await cr.json().catch(() => null);
    if (cr.status !== 200 || cb?.key !== kb.key) return { status: 502, body: { error: "callback_verification_failed" } };
  } catch { return { status: 502, body: { error: "callback_verification_unavailable" } }; }
  const events: Record<string, EventResult> = {};
  for (const eventTypeId of ISV_EVENT_TYPES) {
    try {
      const r = await f(`${LIVE_ISV_API_HOST}/isv/v1/webhooks`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: ISV_WEBHOOK_URL, eventTypeId }), signal: AbortSignal.timeout(15000), redirect: "error",
      });
      // Partner confirms identical URL/event cannot duplicate. ONLY 204 proves success.
      // No listing, invented duplicate error codes or automatic retries.
      events[String(eventTypeId)] = { status: r.status === 204 ? "registered" : "failed", httpStatus: r.status, at: new Date().toISOString() };
    } catch {
      events[String(eventTypeId)] = { status: "unknown", httpStatus: null, at: new Date().toISOString() };
    }
  }
  return { status: 200, body: { events } };
}
