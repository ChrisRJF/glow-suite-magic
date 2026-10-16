// Admin-only registration of LIVE Viva ISV webhooks (8193/8194) on the fixed viva-webhook URL.
// LIVE ISV secrets only; token/secret never returned or logged; fixed URL and event types (no client input).
import { LIVE_ISV_ACCOUNT_HOST, LIVE_ISV_API_HOST, LIVE_ISV_SECRET_NAMES, scopedEnv, type EnvGet } from "./inactive/isvLiveConfig.ts";
import { isPlatformAdmin } from "./isvLiveWebhookKeyFetch.ts";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export const ISV_WEBHOOK_URL = "https://ueqhckkuuwdsrjrdczbb.supabase.co/functions/v1/viva-webhook?isv=1";
export const ISV_EVENT_TYPES = [8193, 8194] as const;
export const CONFIRM_WORD = "register_live_isv_webhooks_8193_8194";

type EventResult = "registered" | "already_registered" | "failed";
export type RegisterResult = { status: number; body: { error?: string; list?: "checked" | "unsupported"; events?: Record<string, EventResult> } };

function listHas(list: unknown, eventTypeId: number): boolean {
  const arr = Array.isArray(list) ? list : Array.isArray((list as any)?.webhooks) ? (list as any).webhooks : [];
  return arr.some((w: any) => String(w?.url ?? w?.Url ?? "") === ISV_WEBHOOK_URL && Number(w?.eventTypeId ?? w?.EventTypeId) === eventTypeId);
}

export async function registerLiveIsvWebhooksForAdmin(
  auth: { userId: string | null; aal: string | null; confirmed: boolean },
  adminIdsRaw: string | undefined, rawGet: EnvGet, f: Fetch,
): Promise<RegisterResult> {
  if (!auth.userId) return { status: 401, body: { error: "unauthorized" } };
  if (!isPlatformAdmin(auth.userId, adminIdsRaw)) return { status: 403, body: { error: "forbidden" } };
  if (auth.aal !== "aal2") return { status: 403, body: { error: "mfa_required" } };
  if (!auth.confirmed) return { status: 400, body: { error: "confirmation_required" } };
  const get = scopedEnv(rawGet);
  if ((get(LIVE_ISV_SECRET_NAMES.enabled) ?? "").trim() !== "true") return { status: 503, body: { error: "live_isv_disabled" } };
  const id = (get(LIVE_ISV_SECRET_NAMES.clientId) ?? "").trim();
  const secret = (get(LIVE_ISV_SECRET_NAMES.clientSecret) ?? "").trim();
  if (!id || !secret) return { status: 503, body: { error: "live_isv_credentials_missing" } };
  let token = "";
  try {
    const t = await f(`${LIVE_ISV_ACCOUNT_HOST}/connect/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const tj: any = await t.json().catch(() => null);
    token = t.ok && typeof tj?.access_token === "string" ? tj.access_token : "";
  } catch { /* fail closed below */ }
  if (!token) return { status: 502, body: { error: "token_unavailable" } };
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Duplicate check when Viva supports listing; any doubt -> stop (never blind POST on unclear list).
  let list: unknown = null, listState: "checked" | "unsupported";
  try {
    const l = await f(`${LIVE_ISV_API_HOST}/isv/v1/webhooks`, { headers: H });
    if (l.ok) { list = await l.json().catch(() => undefined); if (list === undefined) return { status: 502, body: { error: "list_unparseable" } }; listState = "checked"; }
    else if (l.status === 404 || l.status === 405) listState = "unsupported";
    else return { status: 502, body: { error: "list_failed" } };
  } catch { return { status: 502, body: { error: "list_failed" } }; }

  const events: Record<string, EventResult> = {};
  for (const ev of ISV_EVENT_TYPES) {
    if (listState === "checked" && listHas(list, ev)) { events[ev] = "already_registered"; continue; }
    try {
      const r = await f(`${LIVE_ISV_API_HOST}/isv/v1/webhooks`, { method: "POST", headers: H, body: JSON.stringify({ url: ISV_WEBHOOK_URL, eventTypeId: ev }) });
      events[ev] = r.ok ? "registered" : "failed";
    } catch { events[ev] = "failed"; }
    if (events[ev] === "failed") break; // stop on first failure; no retries
  }
  const allOk = ISV_EVENT_TYPES.every((e) => events[e] === "registered" || events[e] === "already_registered");
  return { status: allOk ? 200 : 502, body: { list: listState, events } };
}
