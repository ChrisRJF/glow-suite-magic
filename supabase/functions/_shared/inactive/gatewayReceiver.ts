// INACTIVE. GlowSuite receiver for commands from the separate WhatsApp Gateway.
// Implements docs/glowsuite-dispatch-contract.md (Gateway project), v1:
//   POST /api/integrations/whatsapp-gateway/v1/commands
//   X-GS-Key-Id, X-GS-Timestamp, X-GS-Nonce (= idempotency_key),
//   X-GS-Signature: v1=hex HMAC-SHA256(key, "{key_id}.{ts}.{METHOD}.{path}.{sha256hex(body)}")
// Not imported by any entrypoint. Nothing here sends messages or creates
// appointments, payments, clients or medical records.

export const CONTRACT_VERSION = 1;
export const COMMAND_PATH = "/api/integrations/whatsapp-gateway/v1/commands";
export const MAX_SKEW_SECONDS = 300;
export const MAX_BODY_BYTES = 64 * 1024;

export type ActionType =
  | "opt_out_signal"
  | "inbound_message_record"
  | "delivery_status_record"
  | "confirmation_token_received";
const ACTIONS = new Set<ActionType>([
  "opt_out_signal", "inbound_message_record", "delivery_status_record", "confirmation_token_received",
]);

export interface ReceiverConfig {
  /** GLOWSUITE_WHATSAPP_GATEWAY_ENABLED === "true"; anything else is off. */
  enabled: boolean;
  /** key_id -> secret. Current + previous key during rotation grace. */
  keys: Record<string, string | undefined>;
}

export interface TenantLink {
  salonId: string;
  enabled: boolean;
  allowedActionTypes: ActionType[];
}

export type Effect =
  | { kind: "opt_out"; channel: "whatsapp"; contactRef: string }
  | { kind: "inbound_record"; providerEventId: string; occurredAt: string }
  | { kind: "delivery_status"; outboundRef: string; status: "sent" | "delivered" | "read" | "failed" }
  | { kind: "confirmation_token"; token: string; choice: "attend" | "cancel" };

export interface ReceiptKey {
  idempotencyKey: string;
  tenantId: string;
  actionType: ActionType;
  requestHash: string;
}

export type ProcessOutcome =
  | { result: "applied" }
  | { result: "accepted_noop" }
  | { result: "duplicate"; storedCode: number; storedBody: Record<string, unknown> }
  | { result: "conflict" }
  | { result: "business_rejected"; reason: string };

export interface ReceiverStore {
  resolveTenant(tenantId: string): Promise<TenantLink | null>;
  /**
   * ONE transaction: insert receipt ON CONFLICT DO NOTHING; if it existed,
   * compare request_hash (same -> duplicate with stored response, different ->
   * conflict); else apply the effect scoped to salonId and store the response.
   * Throwing means nothing was committed.
   */
  processOnce(salonId: string, receipt: ReceiptKey, effect: Effect): Promise<ProcessOutcome>;
}

export interface IncomingRequest {
  method: string;
  path: string;
  headers: Record<string, string | null | undefined>;
  rawBody: string;
}

export type ReceiverResult = { status: number; body: { code: string; [k: string]: unknown } };

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export function flagEnabled(v: string | undefined): boolean {
  return v === "true";
}

export async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

export async function signV1(keyId: string, secret: string, ts: string, method: string, path: string, rawBody: string) {
  const base = `${keyId}.${ts}.${method.toUpperCase()}.${path}.${await sha256Hex(rawBody)}`;
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "v1=" + hex(await crypto.subtle.sign("HMAC", k, enc.encode(base)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const r = (status: number, code: string, extra: Record<string, unknown> = {}): ReceiverResult =>
  ({ status, body: { code, ...extra } });

const HEX64 = /^[0-9a-f]{64}$/;
const REF = /^[A-Za-z0-9_-]{16,128}$/;
const TOKEN = /^[A-Za-z0-9._-]{16,512}$/;
const PHONEISH = /^\+?\d{8,15}$/;
const TOP_KEYS = ["contract_version", "idempotency_key", "tenant_id", "action_type", "provider_event_id", "occurred_at", "data"];

function onlyKeys(o: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(o).every((k) => allowed.includes(k));
}

/** Strict schema per action. Returns null for invalid. Never accepts free text. */
export function parseEffect(action: ActionType, data: unknown, providerEventId: string, occurredAt: string): Effect | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  switch (action) {
    case "opt_out_signal":
      // contact_ref must be a hashed / GlowSuite-issued ref, never a phone number.
      if (!onlyKeys(d, ["channel", "contact_ref"]) || d.channel !== "whatsapp") return null;
      if (typeof d.contact_ref !== "string" || !REF.test(d.contact_ref) || PHONEISH.test(d.contact_ref)) return null;
      return { kind: "opt_out", channel: "whatsapp", contactRef: d.contact_ref };
    case "delivery_status_record":
      if (!onlyKeys(d, ["outbound_ref", "status"])) return null;
      if (typeof d.outbound_ref !== "string" || !REF.test(d.outbound_ref)) return null;
      if (!["sent", "delivered", "read", "failed"].includes(String(d.status))) return null;
      return { kind: "delivery_status", outboundRef: d.outbound_ref, status: d.status as any };
    case "inbound_message_record":
      // Metadata only: no body/text/phone fields at all.
      if (Object.keys(d).length !== 0) return null;
      return { kind: "inbound_record", providerEventId, occurredAt };
    case "confirmation_token_received":
      if (!onlyKeys(d, ["token", "choice"])) return null;
      if (typeof d.token !== "string" || !TOKEN.test(d.token)) return null;
      if (d.choice !== "attend" && d.choice !== "cancel") return null;
      return { kind: "confirmation_token", token: d.token, choice: d.choice };
  }
}

export async function handleGatewayCommand(
  cfg: ReceiverConfig,
  store: ReceiverStore,
  req: IncomingRequest,
  nowSeconds: number,
): Promise<ReceiverResult> {
  // 1. Kill switch and configuration: deny everything when off or unconfigured.
  if (!cfg.enabled) return r(503, "disabled");
  if (req.method !== "POST" || req.path !== COMMAND_PATH) return r(404, "not_found");
  if (enc.encode(req.rawBody).length > MAX_BODY_BYTES) return r(400, "invalid_command", { reason: "body_too_large" });

  // 2. Signature with key rotation.
  const h = (n: string) => req.headers[n.toLowerCase()] ?? null;
  const keyId = h("x-gs-key-id"); const ts = h("x-gs-timestamp");
  const nonce = h("x-gs-nonce"); const sig = h("x-gs-signature");
  const secret = keyId ? cfg.keys[keyId] : undefined;
  if (!keyId || !secret || secret.length < 32) return r(401, "bad_signature");
  if (!ts || !/^\d{9,11}$/.test(ts) || Math.abs(nowSeconds - Number(ts)) > MAX_SKEW_SECONDS) return r(401, "stale_timestamp");
  const expected = await signV1(keyId, secret, ts, req.method, req.path, req.rawBody);
  if (!sig || !safeEqual(sig, expected)) return r(401, "bad_signature");

  // 3. Strict body schema.
  let p: Record<string, unknown>;
  try { p = JSON.parse(req.rawBody); } catch { return r(400, "invalid_command", { reason: "bad_json" }); }
  if (!p || typeof p !== "object" || Array.isArray(p) || !onlyKeys(p, TOP_KEYS)) return r(400, "invalid_command", { reason: "unknown_fields" });
  if (p.contract_version !== CONTRACT_VERSION) return r(400, "invalid_command", { reason: "contract_version" });
  if (typeof p.idempotency_key !== "string" || !HEX64.test(p.idempotency_key)) return r(400, "invalid_command", { reason: "idempotency_key" });
  if (nonce !== p.idempotency_key) return r(401, "bad_signature", { reason: "nonce_mismatch" });
  if (typeof p.tenant_id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(p.tenant_id)) return r(400, "invalid_command", { reason: "tenant_id" });
  if (typeof p.action_type !== "string" || !ACTIONS.has(p.action_type as ActionType)) return r(400, "invalid_command", { reason: "action_type" });
  if (typeof p.provider_event_id !== "string" || !p.provider_event_id || p.provider_event_id.length > 256) return r(400, "invalid_command", { reason: "provider_event_id" });
  if (typeof p.occurred_at !== "string" || Number.isNaN(Date.parse(p.occurred_at))) return r(400, "invalid_command", { reason: "occurred_at" });
  const action = p.action_type as ActionType;
  const effect = parseEffect(action, p.data, p.provider_event_id, p.occurred_at);
  if (!effect) return r(400, "invalid_command", { reason: "data" });

  // 4. Tenant allow-list. GlowSuite resolves its own salon id.
  const link = await store.resolveTenant(p.tenant_id);
  if (!link || !link.enabled || !link.allowedActionTypes.includes(action)) return r(403, "tenant_not_authorized");

  // 5. Atomic receipt + business effect.
  const receipt: ReceiptKey = {
    idempotencyKey: p.idempotency_key, tenantId: p.tenant_id, actionType: action,
    requestHash: await sha256Hex(req.rawBody),
  };
  let out: ProcessOutcome;
  try { out = await store.processOnce(link.salonId, receipt, effect); }
  catch { return r(503, "store_unavailable"); } // transient: gateway retries same key
  switch (out.result) {
    case "applied": return r(200, "applied");
    case "accepted_noop": return r(202, "accepted_noop");
    case "duplicate": return r(200, "duplicate", { stored_code: out.storedCode });
    case "conflict": return r(409, "idempotency_conflict");
    case "business_rejected": return r(422, "business_rejected", { reason: out.reason });
  }
}
