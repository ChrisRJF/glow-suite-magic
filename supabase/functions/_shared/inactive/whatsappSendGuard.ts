// INACTIVE (round 8C, 8D: business-event verification step 3b). Proposed security pipeline for a future whatsapp-send.
// Not imported by any entrypoint. All I/O is injected; no network, DB or env here.
//
// Every step fails closed:
//   0. identity   only identities minted by this module count (WeakSet brand). A plain
//                 object such as {kind:"service",caller:"..."} from a wrapper or body is refused.
//                 service: verifyServiceRequest (HMAC v2 over method, path, caller, key id,
//                 timestamp, nonce and sha256 of the exact raw body; atomic nonce store).
//                 user: identityFromVerifiedJwt (verifier bound to the auth server in prod).
//   1. tenant     user: own single tenant. service: derived from the referenced rows
//   2. purpose    derived server-side from (identity, kind). Never from the message body.
//   3. recipient  ALWAYS a customer of the tenant; destination = stored, normalised phone.
//   4. consent    STOP (salon) > preference opt-out > explicit opt-in > marketing_consent.
//                 Any lookup error or unexpected value -> 503, never "no opt-out".
//   5. idem key   user sends: client action_id (UUID, kept across retries of ONE action).
//                 service sends: event_ref bound to the business event (appointment+slot,
//                 automation run, rebook action, form request). Invalid key -> 422, never replaced.
//   6. claim      atomic per (tenant, key), bound to a fingerprint of recipient+purpose+content.
//   7. transport  mocked in tests; throw = outcome unknown, never auto-resent.
//   8. finalize   minimal log: masked phone, keyed HMAC fingerprints, provider code only.

import { evaluateWhatsAppConsent, type MessagePurpose } from "./whatsappConsent.ts";
import { normalizeE164 } from "./contactRef.ts";
import { verifyBusinessEvent, type EventResolver, type EventType as EvType } from "./eventVerifier.ts";

export type Role = "eigenaar" | "admin" | "manager" | "medewerker" | "financieel" | "receptie";

export type ServiceCaller =
  | "reminder-scheduler" | "automation-scheduler" | "auto-rebook" | "booking-confirmation"
  | "payment-webhook" | "customer-forms";

export type Identity = Readonly<
  | { kind: "anonymous" }
  | { kind: "service"; caller: ServiceCaller }
  | { kind: "user"; userId: string }
>;

// ---- identity branding ------------------------------------------------------
const MINTED = new WeakSet<object>();
function mint<T extends Identity>(i: T): T { Object.freeze(i); MINTED.add(i); return i; }
export const ANONYMOUS: Identity = mint({ kind: "anonymous" });
export function isVerifiedIdentity(i: unknown): i is Identity {
  return typeof i === "object" && i !== null && MINTED.has(i);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** In production `verify` MUST be bound to the auth server (auth.getUser(token)). */
export async function identityFromVerifiedJwt(
  bearer: string | null | undefined,
  verify: (token: string) => Promise<{ sub: string } | null>,
): Promise<Identity> {
  const m = typeof bearer === "string" ? /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(bearer) : null;
  if (!m) return ANONYMOUS;
  let r: { sub: string } | null = null;
  try { r = await verify(m[1]); } catch { return ANONYMOUS; }
  if (!r || typeof r.sub !== "string" || !UUID.test(r.sub)) return ANONYMOUS;
  return mint({ kind: "user", userId: r.sub.toLowerCase() });
}

// ---- service authentication (HMAC v2) --------------------------------------
export const SEND_METHOD = "POST";
export const SEND_PATH = "/functions/v1/whatsapp-send";
export const MAX_SKEW_S = 300;
const CALLERS: ServiceCaller[] = ["reminder-scheduler", "automation-scheduler", "auto-rebook", "booking-confirmation", "payment-webhook", "customer-forms"];

/** Per caller: the key id used for signing + every key id still accepted (rotation). */
export type ServiceKeyConfig = Partial<Record<ServiceCaller, { current: string; keys: Record<string, Uint8Array> }>>;
export interface SignedRequest {
  method: string; path: string; rawBody: string;
  headers: { caller?: string | null; keyId?: string | null; ts?: string | null; nonce?: string | null; sig?: string | null };
}
export interface ServiceVerifyDeps {
  keys: ServiceKeyConfig | null;          // null = not configured -> deny
  now(): number;                          // ms
  hmacHex(key: Uint8Array, msg: string): Promise<string>;
  sha256Hex(msg: string): Promise<string>;
  /** Atomic insert-if-absent. true = stored now, false = seen before. Throw = store down. */
  rememberNonce(caller: string, nonce: string, expiresAtMs: number): Promise<boolean>;
}

export function signingString(method: string, path: string, caller: string, keyId: string, ts: string, nonce: string, bodySha: string) {
  return ["wa-send:v2", method, path, caller, keyId, ts, nonce, bodySha].join("\n");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Whole config must be valid; one bad entry denies everything (no partial trust). */
export function validateKeyConfig(cfg: unknown): cfg is ServiceKeyConfig {
  if (!cfg || typeof cfg !== "object") return false;
  const entries = Object.entries(cfg as Record<string, unknown>);
  if (entries.length === 0) return false;
  for (const [caller, v] of entries) {
    if (!CALLERS.includes(caller as ServiceCaller) || !v || typeof v !== "object") return false;
    const { current, keys } = v as { current?: unknown; keys?: unknown };
    if (typeof current !== "string" || !keys || typeof keys !== "object") return false;
    const ks = Object.entries(keys as Record<string, unknown>);
    if (!ks.length || !ks.some(([id]) => id === current)) return false;
    for (const [id, k] of ks) if (!/^[a-z0-9]{1,16}$/.test(id) || !(k instanceof Uint8Array) || k.length < 32) return false;
  }
  return true;
}

export async function verifyServiceRequest(r: SignedRequest, d: ServiceVerifyDeps):
  Promise<{ ok: true; identity: Identity } | { ok: false; reason: string }> {
  if (!d.keys) return { ok: false, reason: "service_auth_not_configured" };
  if (!validateKeyConfig(d.keys)) return { ok: false, reason: "service_auth_misconfigured" };
  if (r.method !== SEND_METHOD || r.path !== SEND_PATH) return { ok: false, reason: "wrong_route" };
  if (typeof r.rawBody !== "string") return { ok: false, reason: "bad_body" };
  const h = r.headers ?? {};
  const caller = h.caller ?? "";
  if (!CALLERS.includes(caller as ServiceCaller)) return { ok: false, reason: "unknown_caller" };
  const entry = d.keys[caller as ServiceCaller];
  if (!entry) return { ok: false, reason: "caller_key_missing" };
  const keyId = h.keyId ?? "";
  const key = Object.prototype.hasOwnProperty.call(entry.keys, keyId) ? entry.keys[keyId] : undefined;
  if (!key) return { ok: false, reason: "unknown_key_id" };
  if (!h.ts || !/^\d{10}$/.test(h.ts)) return { ok: false, reason: "bad_timestamp" };
  const nowS = d.now() / 1000;
  if (Math.abs(nowS - Number(h.ts)) > MAX_SKEW_S) return { ok: false, reason: "stale_timestamp" };
  if (!h.nonce || !/^[0-9a-f]{32,64}$/.test(h.nonce)) return { ok: false, reason: "bad_nonce" };
  if (!h.sig || !/^[0-9a-f]{64}$/.test(h.sig)) return { ok: false, reason: "bad_signature" };
  const expected = await d.hmacHex(key, signingString(r.method, r.path, caller, keyId, h.ts, h.nonce, await d.sha256Hex(r.rawBody)));
  if (!safeEqualHex(expected, h.sig)) return { ok: false, reason: "bad_signature" };
  let stored: unknown;
  try { stored = await d.rememberNonce(caller, h.nonce, (Number(h.ts) + MAX_SKEW_S * 2) * 1000); }
  catch { return { ok: false, reason: "nonce_store_unavailable" }; }
  if (stored !== true) return { ok: false, reason: "replay" };
  return { ok: true, identity: mint({ kind: "service", caller: caller as ServiceCaller }) };
}

/** The ONLY service entry: the executed body is parsed from the exact signed bytes. */
export async function handleServiceSend(r: SignedRequest, v: ServiceVerifyDeps, d: Deps): Promise<Result> {
  const auth = await verifyServiceRequest(r, v);
  if (auth.ok === false) return no(401, auth.reason);
  let body: unknown;
  try { body = JSON.parse(r.rawBody); } catch { return no(400, "invalid_json"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return no(400, "invalid_json");
  return guardedSend(auth.identity, body as SendRequest, d);
}

// ---- purpose policy (server-side, never from the body) ---------------------
// "transactional" for confirmations / no-show is a PROPOSAL, not a decision.
// Classification never creates consent and never bypasses STOP.
export const POLICY_PENDING: ReadonlyArray<string> = ["confirmation", "no_show", "form_request", "form_reminder"];
type EventType = "appointment" | "automation_run" | "rebook_action" | "form_request";
const SERVICE_KINDS: Record<ServiceCaller, Partial<Record<string, { purpose: MessagePurpose; event: EventType; slot?: boolean }>>> = {
  "reminder-scheduler": {
    reminder: { purpose: "transactional", event: "appointment", slot: true },
    review: { purpose: "marketing", event: "appointment" },
    no_show: { purpose: "transactional", event: "appointment" },
  },
  // Automation reminder triggers must send kind "reminder" with the appointment event ref, so the
  // claim key equals the reminder-scheduler's key (caller-independent) and only one is ever sent.
  "automation-scheduler": {
    automation: { purpose: "marketing", event: "automation_run" },
    reminder: { purpose: "transactional", event: "appointment", slot: true },
  },
  "auto-rebook": { auto_rebook: { purpose: "marketing", event: "rebook_action" } },
  "booking-confirmation": { confirmation: { purpose: "transactional", event: "appointment" } },
  "payment-webhook": { confirmation: { purpose: "transactional", event: "appointment" } },
  "customer-forms": {
    form_request: { purpose: "transactional", event: "form_request" },
    form_reminder: { purpose: "transactional", event: "form_request", slot: true },
  },
};
const STAFF: Role[] = ["eigenaar", "admin", "manager", "receptie"];
const USER_KINDS: Partial<Record<string, { purpose: MessagePurpose; roles: Role[] }>> = {
  // Free-text staff messages: purpose is not verifiable -> strictest (marketing) consent.
  manual: { purpose: "marketing", roles: STAFF },
  waitlist_offer: { purpose: "marketing", roles: STAFF },
  campaign: { purpose: "marketing", roles: ["eigenaar", "admin", "manager"] },
  // test: owner/admin only, still to a consenting customer of the own salon.
  test: { purpose: "marketing", roles: ["eigenaar", "admin"] },
  campaign_test: { purpose: "marketing", roles: ["eigenaar", "admin"] },
};

// ---- main pipeline ---------------------------------------------------------
export interface SendRequest {
  user_id?: unknown; to?: unknown; message?: unknown; kind?: unknown; test?: unknown;
  customer_id?: unknown; appointment_id?: unknown; reminder_type?: unknown;
  /** user sends: one UUID per deliberate send action, reused on retries */
  action_id?: unknown;
  /** legacy alias of action_id for user sends; refused for service sends */
  idempotency_key?: unknown;
  /** service sends: business event, e.g. "appointment:<uuid>:24h", "automation_run:<uuid>" */
  event_ref?: unknown;
  /** Meta template body parameters ({{1}}..{{n}}), positional. Free text has no parameters. */
  template_params?: unknown;
}
/** Provider preparation (Meta templates/sender). Runs before the claim, never for demo tenants. */
export interface PrepareInput { tenantId: string; kind: string; purpose: MessagePurpose; message: string; params: string[] }
export type PrepareResult = { ok: true; payload: unknown } | { ok: false; status: 403 | 409 | 422 | 503; reason: string };
export interface CustomerRow {
  id: string; user_id: string | null; phone: string | null;
  whatsapp_opt_in: boolean | null; marketing_consent: boolean | null;
  archived_at: string | null; pseudonymized_at: string | null; communication_blocked_at: string | null;
}
export type ClaimState = "claimed" | "sent" | "failed" | "unknown";
export type ClaimResult = { created: true } | { created: false; state: ClaimState; fingerprint: string };

export interface Deps {
  tenantOfUser(userId: string): Promise<string | null>;
  roleInTenant(userId: string, tenantId: string): Promise<Role | null>;
  customer(id: string): Promise<CustomerRow | null>;
  appointment(id: string): Promise<{ user_id: string; customer_id: string | null } | null>;
  /** null = no preference row; throw = lookup failed (-> blocked) */
  preferenceWhatsappOptOut(tenantId: string, customerId: string): Promise<boolean | null>;
  /** throw = lookup failed (-> blocked) */
  isStopped(tenantId: string, e164: string): Promise<boolean>;
  whatsappEnabled(tenantId: string): Promise<boolean>;
  /** Emergency stop (tenant_feature_flags). true / throw / non-boolean = paused: no claim, no provider. */
  sendingPaused(tenantId: string): Promise<boolean>;
  isDemoTenant(tenantId: string): Promise<boolean>;
  /** Atomic: INSERT ... ON CONFLICT DO NOTHING, then read existing row. */
  claim(tenantId: string, key: string, fingerprint: string): Promise<ClaimResult>;
  finalize(tenantId: string, key: string, state: ClaimState, log: MinimalLog): Promise<void>;
  /** Real adapters must provide this; throw = lookup failed (-> 503, no claim). */
  prepare?(input: PrepareInput): Promise<PrepareResult>;
  transport(toE164: string, body: string, prepared?: unknown): Promise<{ accepted: boolean; sid?: string; code?: number }>;
  /** Keyed HMAC with a server-only secret. Short messages are guessable by plain hash. */
  hmac(purpose: string, value: string): Promise<string>;
  /** Round 8D: loads the referenced business event by id. null = missing; throw = lookup failed. */
  resolveEvent: EventResolver;
  now(): number;
}
export interface MinimalLog {
  tenant_id: string; customer_id: string; appointment_id: string | null; kind: string; purpose: MessagePurpose;
  to_masked: string; content_fp: string; provider_sid: string | null; provider_code: number | null; status: ClaimState;
}
type Status = 400 | 401 | 403 | 409 | 422 | 502 | 503;
export type Result =
  | { ok: true; status: 200; result: "sent" | "simulated"; sid?: string }
  | { ok: false; status: Status; reason: string };

const EVENT_REF = /^(appointment|automation_run|rebook_action|form_request):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::([a-z0-9_]{1,32}))?$/;
const no = (status: Status, reason: string): Result => ({ ok: false, status, reason });
export const maskPhone = (e: string) => (e.length > 6 ? `${e.slice(0, 3)}****${e.slice(-2)}` : "****");

/** Pure: derives the idempotency slot or refuses. Exported for tests. */
export function deriveSlot(identity: Identity, kind: string, req: SendRequest, appointmentId: string | null):
  { ok: true; slot: string } | { ok: false; reason: string } {
  if (identity.kind === "user") {
    const a = req.action_id, k = req.idempotency_key;
    if (a !== undefined && k !== undefined && a !== k) return { ok: false, reason: "action_id_mismatch" };
    const v = a ?? k;
    if (v === undefined || v === null) return { ok: false, reason: "action_id_required" };
    if (typeof v !== "string" || !UUID.test(v)) return { ok: false, reason: "invalid_action_id" };
    return { ok: true, slot: `user|${v.toLowerCase()}` };
  }
  if (identity.kind !== "service") return { ok: false, reason: "unauthenticated" };
  if (req.idempotency_key !== undefined || req.action_id !== undefined) return { ok: false, reason: "client_key_not_allowed_for_service" };
  const rule = SERVICE_KINDS[identity.caller]?.[kind];
  if (!rule) return { ok: false, reason: "kind_not_allowed_for_caller" };
  if (typeof req.event_ref !== "string") return { ok: false, reason: "event_ref_required" };
  const m = EVENT_REF.exec(req.event_ref);
  if (!m) return { ok: false, reason: "invalid_event_ref" };
  if (m[1] !== rule.event) return { ok: false, reason: "event_type_mismatch" };
  if (rule.slot && !m[3]) return { ok: false, reason: "event_slot_required" };
  if (!rule.slot && m[3]) return { ok: false, reason: "invalid_event_ref" };
  if (rule.event === "appointment" && m[2] !== appointmentId) return { ok: false, reason: "event_appointment_mismatch" };
  return { ok: true, slot: `event|${kind}|${req.event_ref}` };
}

export async function guardedSend(identity: Identity, req: SendRequest, d: Deps): Promise<Result> {
  if (!isVerifiedIdentity(identity)) return no(401, "identity_not_verified");
  if (identity.kind === "anonymous") return no(401, "unauthenticated");
  if (req.test !== undefined && req.test !== false && req.test !== true) return no(400, "invalid_test_flag");
  let kind = typeof req.kind === "string" ? req.kind : "";
  if (req.test === true && kind !== "test" && kind !== "campaign_test") kind = "test";
  if (req.test !== true && (kind === "test" || kind === "campaign_test")) return no(400, "test_kind_requires_test_flag");
  if (typeof req.message !== "string" || !req.message || req.message.length > 1600) return no(400, "invalid_message");
  const customerId = req.customer_id == null ? null : String(req.customer_id);
  const appointmentId = req.appointment_id == null ? null : String(req.appointment_id);
  if ((customerId && !UUID.test(customerId)) || (appointmentId && !UUID.test(appointmentId))) return no(400, "invalid_reference");
  if (identity.kind === "service" && req.test === true) return no(403, "test_not_allowed_for_service");

  // Key shape is validated before any read: an invalid explicit key is refused, never replaced.
  const slot = deriveSlot(identity, kind, req, appointmentId);
  if (slot.ok === false) return no(slot.reason === "kind_not_allowed_for_caller" ? 403 : 422, slot.reason);

  const appt = appointmentId ? await d.appointment(appointmentId) : null;
  if (appointmentId && !appt) return no(403, "appointment_not_found");
  const resolvedCustomerId = customerId ?? appt?.customer_id ?? null;
  if (!resolvedCustomerId) return no(422, "recipient_unverified");
  if (customerId && appt?.customer_id && appt.customer_id !== customerId) return no(403, "appointment_customer_mismatch");
  if (appointmentId && !appt?.customer_id) return no(422, "appointment_without_customer");
  const customer = await d.customer(resolvedCustomerId);
  if (!customer || !customer.user_id) return no(403, "customer_not_found");

  let tenantId: string; let purpose: MessagePurpose;
  if (identity.kind === "service") {
    purpose = SERVICE_KINDS[identity.caller]![kind]!.purpose;
    tenantId = customer.user_id;
  } else {
    const own = await d.tenantOfUser(identity.userId);
    if (!own) return no(403, "no_tenant");
    tenantId = own;
    const rule = USER_KINDS[kind];
    if (!rule) return no(422, "purpose_unknown");
    const role = await d.roleInTenant(identity.userId, tenantId);
    if (!role) return no(403, "not_member_of_tenant");
    if (!rule.roles.includes(role)) return no(403, "role_not_allowed");
    purpose = rule.purpose;
  }
  if (req.user_id !== undefined && req.user_id !== tenantId) return no(403, "body_tenant_mismatch");
  if (customer.user_id !== tenantId) return no(403, "customer_not_in_tenant");
  if (appt && appt.user_id !== tenantId) return no(403, "appointment_not_in_tenant");

  // Emergency stop first; then salon settings. test=true never skips either.
  let paused: unknown, demo: unknown, enabled: unknown;
  try { paused = await d.sendingPaused(tenantId); } catch { return no(503, "sending_paused"); }
  if (paused !== false) return no(503, "sending_paused");
  try { demo = await d.isDemoTenant(tenantId); } catch { return no(503, "settings_lookup_failed"); }
  if (typeof demo !== "boolean") return no(503, "settings_lookup_failed");
  if (!demo) {
    try { enabled = await d.whatsappEnabled(tenantId); } catch { return no(503, "settings_lookup_failed"); }
    if (enabled !== true) return no(409, "whatsapp_disabled");
  }

  // 3b. Service sends: the signed event_ref is only a claim. Verify the event row itself.
  if (identity.kind === "service") {
    const m = EVENT_REF.exec(req.event_ref as string)!;
    const ev = await verifyBusinessEvent({ type: m[1] as EvType, id: m[2], slot: m[3] ?? null, kind, tenantId,
      customerId: customer.id, appointmentId, nowMs: d.now() }, d.resolveEvent);
    if (ev.ok === false) return no(ev.status, ev.reason);
  }

  const dest = normalizeE164(customer.phone);
  if (!dest) return no(422, "customer_phone_invalid");
  if (req.to !== undefined) {
    const asked = normalizeE164(req.to);
    if (!asked) return no(422, "invalid_phone");
    if (asked !== dest) return no(422, "phone_mismatch");
  }

  // Consent: STOP first. Lookup errors / odd values are never read as "not stopped".
  let stopped: unknown, pref: unknown;
  try { stopped = await d.isStopped(tenantId, dest); } catch { return no(503, "consent_lookup_failed"); }
  if (typeof stopped !== "boolean") return no(503, "consent_lookup_failed");
  if (stopped) return no(409, "customer_stopped");
  try { pref = await d.preferenceWhatsappOptOut(tenantId, customer.id); } catch { return no(503, "consent_lookup_failed"); }
  if (pref !== true && pref !== false && pref !== null) return no(503, "consent_lookup_failed");
  const c = evaluateWhatsAppConsent({ purpose, tenantId, customer, stoppedInTenant: false, preferenceWhatsappOptOut: pref as boolean | null });
  if (c.allowed === false) return no(409, c.reason);

  // Template params: plain positional strings only (Meta forbids newlines/tabs in parameters).
  const params = req.template_params === undefined ? [] : req.template_params;
  if (!Array.isArray(params) || params.length > 10 ||
    !params.every((p) => typeof p === "string" && p.trim() !== "" && p.length <= 256 && !/[\n\t]| {5,}/.test(p)))
    return no(400, "invalid_template_params");

  // Provider preparation before the claim: an invalid template/sender never burns a key. Demo: no provider I/O.
  let prepared: unknown = undefined;
  if (!demo && d.prepare) {
    let p: PrepareResult;
    try { p = await d.prepare({ tenantId, kind, purpose, message: req.message, params: params as string[] }); }
    catch { return no(503, "template_lookup_failed"); }
    if (!p || p.ok !== true) return no((p?.status ?? 503) as Status, p?.reason ?? "template_lookup_failed");
    prepared = p.payload;
  }

  const key = await d.hmac("claim", `${tenantId}|${slot.slot}`);
  const contentFp = await d.hmac("content", params.length ? `${req.message}\u0000${JSON.stringify(params)}` : req.message);
  const fingerprint = await d.hmac("fp", [tenantId, kind, purpose, customer.id, appointmentId ?? "-", dest, contentFp].join("|"));
  let claim: ClaimResult;
  try { claim = await d.claim(tenantId, key, fingerprint); } catch { return no(503, "claim_store_unavailable"); }
  if (claim.created === false) {
    if (claim.fingerprint !== fingerprint) return no(409, "idempotency_conflict");
    if (claim.state === "sent") return no(409, "duplicate");
    if (claim.state === "failed") return no(409, "previous_attempt_failed_needs_new_action");
    return no(409, "outcome_unknown");
  }
  const base = { tenant_id: tenantId, customer_id: customer.id, appointment_id: appointmentId, kind, purpose,
    to_masked: maskPhone(dest), content_fp: contentFp };

  if (demo === true) {
    await d.finalize(tenantId, key, "sent", { ...base, provider_sid: null, provider_code: null, status: "sent" });
    return { ok: true, status: 200, result: "simulated" };
  }

  let r: { accepted: boolean; sid?: string; code?: number };
  try { r = await d.transport(dest, req.message, prepared); }
  catch {
    await d.finalize(tenantId, key, "unknown", { ...base, provider_sid: null, provider_code: null, status: "unknown" }).catch(() => {});
    return no(502, "outcome_unknown");
  }
  const state: ClaimState = r.accepted ? "sent" : "failed";
  await d.finalize(tenantId, key, state, { ...base, provider_sid: r.sid ?? null,
    provider_code: typeof r.code === "number" ? r.code : null, status: state }).catch(() => {});
  return r.accepted ? { ok: true, status: 200, result: "sent", sid: r.sid } : no(502, "provider_rejected");
}
