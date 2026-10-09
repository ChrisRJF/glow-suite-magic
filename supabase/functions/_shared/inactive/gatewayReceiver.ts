// INACTIVE. Receiver for events from the separate GlowSuite WhatsApp Gateway.
// Assumed contract (HMAC-v1, to be checked against the Gateway's
// docs/glowsuite-dispatch-contract.md before wiring):
//   header x-glowsuite-timestamp: unix seconds
//   header x-glowsuite-signature: v1=<hex hmac-sha256(secret, `v1:${ts}:${rawBody}`)>
//   body { event_id, environment, gateway_tenant_ref, type, ... }
// Never creates appointments or payments. Free text is ignored.

export const MAX_SKEW_SECONDS = 300;

export interface ReceiverConfig {
  enabled: boolean;              // GLOWSUITE_WHATSAPP_GATEWAY_ENABLED === "true"
  secret: string | undefined;    // per-environment HMAC secret
  environment: string;           // e.g. "production"
}

export interface ReceiverStore {
  /** Maps gateway tenant ref to GlowSuite tenant id, only if that tenant has the gateway enabled. */
  resolveTenant(ref: string): Promise<string | null>;
  /**
   * Atomically records the receipt AND applies the business effect in one
   * transaction. Returns "duplicate" if event_id was already processed.
   * Throwing means nothing was committed.
   */
  applyOnce(tenantId: string, eventId: string, effect: ReceiverEffect): Promise<"applied" | "duplicate">;
}

export type ReceiverEffect =
  | { kind: "stop"; phone: string }
  | { kind: "delivery_status"; providerMessageId: string; status: "sent" | "delivered" | "read" | "failed" }
  | { kind: "confirmation"; bookingToken: string; answer: "confirm" | "decline" }
  | { kind: "ignored"; reason: string };

export type ReceiverResult = { status: number; body: Record<string, unknown> };

export function flagEnabled(v: string | undefined): boolean {
  return v === "true";
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signV1(secret: string, ts: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "v1=" + hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v1:${ts}:${rawBody}`)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const STATUSES = new Set(["sent", "delivered", "read", "failed"]);
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export function toEffect(p: Record<string, unknown>): ReceiverEffect {
  switch (p.type) {
    case "stop":
      return typeof p.phone === "string" && p.phone ? { kind: "stop", phone: p.phone } : { kind: "ignored", reason: "bad_stop" };
    case "delivery_status":
      return typeof p.provider_message_id === "string" && STATUSES.has(String(p.status))
        ? { kind: "delivery_status", providerMessageId: p.provider_message_id, status: p.status as any }
        : { kind: "ignored", reason: "bad_status" };
    case "confirmation":
      // Only a verified booking token counts; never parsed from free text.
      return typeof p.booking_token === "string" && TOKEN.test(p.booking_token) && (p.answer === "confirm" || p.answer === "decline")
        ? { kind: "confirmation", bookingToken: p.booking_token, answer: p.answer }
        : { kind: "ignored", reason: "bad_confirmation" };
    default:
      return { kind: "ignored", reason: "unsupported_type" };
  }
}

export async function handleGatewayEvent(
  cfg: ReceiverConfig,
  store: ReceiverStore,
  headers: { timestamp?: string | null; signature?: string | null },
  rawBody: string,
  nowSeconds: number,
): Promise<ReceiverResult> {
  if (!cfg.enabled) return { status: 404, body: { error: "disabled" } };
  if (!cfg.secret) return { status: 503, body: { error: "not_configured" } };
  const ts = headers.timestamp ?? "";
  if (!/^\d{9,11}$/.test(ts) || Math.abs(nowSeconds - Number(ts)) > MAX_SKEW_SECONDS) {
    return { status: 401, body: { error: "stale_or_missing_timestamp" } };
  }
  const expected = await signV1(cfg.secret, ts, rawBody);
  if (!headers.signature || !safeEqual(headers.signature, expected)) {
    return { status: 401, body: { error: "bad_signature" } };
  }
  let p: Record<string, unknown>;
  try { p = JSON.parse(rawBody); } catch { return { status: 400, body: { error: "bad_json" } }; }
  if (p.environment !== cfg.environment) return { status: 403, body: { error: "wrong_environment" } };
  if (typeof p.event_id !== "string" || !p.event_id) return { status: 400, body: { error: "missing_event_id" } };
  if (typeof p.gateway_tenant_ref !== "string") return { status: 400, body: { error: "missing_tenant" } };
  const tenantId = await store.resolveTenant(p.gateway_tenant_ref);
  if (!tenantId) return { status: 403, body: { error: "tenant_not_enabled" } };
  const effect = toEffect(p);
  try {
    const r = await store.applyOnce(tenantId, p.event_id, effect);
    return { status: 200, body: { ok: true, duplicate: r === "duplicate" } };
  } catch {
    // Nothing committed: let the Gateway retry with the same event_id.
    return { status: 500, body: { error: "store_failed" } };
  }
}
