// Admin-only registration of LIVE Viva ISV webhooks (8193/8194) on the fixed viva-webhook URL.
// LIVE ISV secrets only; token/secret never returned or logged; fixed URL and event types (no client input).
import { LIVE_ISV_SECRET_NAMES, scopedEnv, type EnvGet } from "./inactive/isvLiveConfig.ts";
import { isPlatformAdmin } from "./isvLiveWebhookKeyFetch.ts";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export const ISV_WEBHOOK_URL = "https://ueqhckkuuwdsrjrdczbb.supabase.co/functions/v1/viva-webhook?isv=1";
// Vendor-confirmed POST /isv/v1/webhooks event set, prepared only. No listing API exists.
export const ISV_EVENT_TYPES = [1796, 1797, 1798, 8193, 8194] as const;
export const CONFIRM_WORD = "register_live_isv_webhooks_8193_8194";

type EventResult = "registered" | "already_registered" | "failed";
export type RegisterResult = { status: number; body: { error?: string; list?: "checked" | "unsupported"; events?: Record<string, EventResult> } };

export async function registerLiveIsvWebhooksForAdmin(
  auth: { userId: string | null; aal: string | null; confirmed: boolean },
  adminIdsRaw: string | undefined, rawGet: EnvGet, _f: Fetch,
): Promise<RegisterResult> {
  if (!auth.userId) return { status: 401, body: { error: "unauthorized" } };
  if (!isPlatformAdmin(auth.userId, adminIdsRaw)) return { status: 403, body: { error: "forbidden" } };
  if (auth.aal !== "aal2") return { status: 403, body: { error: "mfa_required" } };
  if (!auth.confirmed) return { status: 400, body: { error: "confirmation_required" } };
  const get = scopedEnv(rawGet);
  if ((get(LIVE_ISV_SECRET_NAMES.enabled) ?? "").trim() !== "true") return { status: 503, body: { error: "live_isv_disabled" } };
  // No durable, account/URL/event-bound evidence exists in this installation.
  // Do not accept client evidence, interpret 405 as absence, or send any provider request.
  // Viva partner must first confirm exact existing subscriptions and verified missing events.
  return { status: 409, body: { error: "registration_evidence_required" } };
}
