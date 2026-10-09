// INACTIVE (round 8B). Proposed security pipeline for a future whatsapp-send.
// Not imported by any entrypoint. All I/O is injected; no network, DB or env here.
//
// Every step fails closed:
//   1. identity   user: verified JWT (resolved by caller). service: HMAC-signed request
//                 with a per-caller secret (verifyServiceRequest); body caller names count for nothing
//   2. tenant     user: own single tenant. service: derived from the referenced rows
//   3. purpose    derived server-side from (identity, kind). Never from the message body.
//   4. recipient  ALWAYS a customer of the tenant, resolved from customer_id or the
//                 appointment's customer. Destination = the customer's stored phone (normalised).
//                 No customer -> refused. There is no "test to arbitrary number" path.
//   5. consent    STOP (salon) > preference opt-out > explicit opt-in > marketing_consent
//   6. claim      atomic claim keyed by (tenant, idempotency key) and bound to a fingerprint
//                 of recipient+purpose+content; same key, other fingerprint -> 409
//   7. transport  mocked in tests; throw = outcome unknown, never auto-resent
//   8. finalize   minimal log: masked phone, keyed HMAC fingerprints, provider code only

import { evaluateWhatsAppConsent, type MessagePurpose } from "./whatsappConsent.ts";
import { normalizeE164 } from "./contactRef.ts";

export type Role = "eigenaar" | "admin" | "manager" | "medewerker" | "financieel" | "receptie";

export type ServiceCaller =
  | "reminder-scheduler" | "automation-scheduler" | "auto-rebook" | "booking-confirmation"
  | "payment-webhook" | "customer-forms";

/** Identity as established by verified server context only. */
export type Identity =
  | { kind: "anonymous" }
  | { kind: "service"; caller: ServiceCaller } // only produced by verifyServiceRequest
  | { kind: "user"; userId: string };          // only from a verified JWT

// ---- service authentication ------------------------------------------------
// Each internal function gets its OWN secret (>= 32 bytes). A request is
// signed over caller|timestamp|nonce|sha256(body). The service-role key alone
// is never accepted as proof of a caller.
export interface ServiceKeys { [caller: string]: Uint8Array }
export interface SignedHeaders { caller?: string | null; ts?: string | null; nonce?: string | null; sig?: string | null }
export interface ServiceVerifyDeps {
  keys: ServiceKeys | null;               // null = not configured -> deny
  now(): number;                          // ms
  hmacHex(key: Uint8Array, msg: string): Promise<string>;
  sha256Hex(msg: string): Promise<string>;
  /** atomic insert-if-absent of a nonce for the replay window; false = seen */
  rememberNonce(caller: string, nonce: string): Promise<boolean>;
}
const CALLERS: ServiceCaller[] = ["reminder-scheduler", "automation-scheduler", "auto-rebook", "booking-confirmation", "payment-webhook", "customer-forms"];

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyServiceRequest(h: SignedHeaders, rawBody: string, d: ServiceVerifyDeps):
  Promise<{ ok: true; identity: Identity } | { ok: false; reason: string }> {
  if (!d.keys) return { ok: false, reason: "service_auth_not_configured" };
  const caller = h.caller ?? "";
  if (!CALLERS.includes(caller as ServiceCaller)) return { ok: false, reason: "unknown_caller" };
  const key = d.keys[caller];
  if (!(key instanceof Uint8Array) || key.length < 32) return { ok: false, reason: "caller_key_missing" };
  if (!h.ts || !/^\d{10}$/.test(h.ts)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(d.now() / 1000 - Number(h.ts)) > 300) return { ok: false, reason: "stale_timestamp" };
  if (!h.nonce || !/^[0-9a-f]{32,64}$/.test(h.nonce)) return { ok: false, reason: "bad_nonce" };
  if (!h.sig || !/^[0-9a-f]{64}$/.test(h.sig)) return { ok: false, reason: "bad_signature" };
  const expected = await d.hmacHex(key, `wa-send:v1|${caller}|${h.ts}|${h.nonce}|${await d.sha256Hex(rawBody)}`);
  if (!safeEqualHex(expected, h.sig)) return { ok: false, reason: "bad_signature" };
  if (!(await d.rememberNonce(caller, h.nonce))) return { ok: false, reason: "replay" };
  return { ok: true, identity: { kind: "service", caller: caller as ServiceCaller } };
}

// ---- purpose policy (server-side, never from the body) ---------------------
// Booking/payment confirmations are listed as transactional ONLY as a proposal;
// they need a separate policy decision before going live (see README).
const SERVICE_KINDS: Record<ServiceCaller, Partial<Record<string, MessagePurpose>>> = {
  "reminder-scheduler": { reminder: "transactional", review: "marketing", no_show: "transactional" },
  "automation-scheduler": { automation: "marketing" },
  "auto-rebook": { rebook: "marketing" },
  "booking-confirmation": { booking_confirmation: "transactional" },
  "payment-webhook": { booking_confirmation: "transactional" },
  "customer-forms": { form_request: "transactional" },
};
const USER_KINDS: Partial<Record<string, { purpose: MessagePurpose; roles: Role[] }>> = {
  // Free-text staff messages: purpose is not verifiable -> strictest (marketing) consent.
  manual: { purpose: "marketing", roles: ["eigenaar", "admin", "manager", "receptie"] },
  waitlist_offer: { purpose: "marketing", roles: ["eigenaar", "admin", "manager", "receptie"] },
  campaign: { purpose: "marketing", roles: ["eigenaar", "admin", "manager"] },
  // test: owner/admin only, still to a consenting customer of the own salon.
  test: { purpose: "marketing", roles: ["eigenaar", "admin"] },
};

// ---- main pipeline ---------------------------------------------------------
export interface SendRequest {
  user_id?: unknown; to?: unknown; message?: unknown; kind?: unknown; test?: unknown;
  customer_id?: unknown; appointment_id?: unknown; reminder_type?: unknown; idempotency_key?: unknown;
}
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
  preferenceWhatsappOptOut(tenantId: string, customerId: string): Promise<boolean | null>;
  isStopped(tenantId: string, e164: string): Promise<boolean>;
  whatsappEnabled(tenantId: string): Promise<boolean>;
  isDemoTenant(tenantId: string): Promise<boolean>;
  /** Atomic: INSERT ... ON CONFLICT DO NOTHING, then read existing row. */
  claim(tenantId: string, key: string, fingerprint: string): Promise<ClaimResult>;
  finalize(tenantId: string, key: string, state: ClaimState, log: MinimalLog): Promise<void>;
  transport(toE164: string, body: string): Promise<{ accepted: boolean; sid?: string; code?: number }>;
  /** Keyed HMAC with a server-only secret. Short messages are guessable by plain hash. */
  hmac(purpose: string, value: string): Promise<string>;
}
export interface MinimalLog {
  tenant_id: string; customer_id: string; appointment_id: string | null; kind: string; purpose: MessagePurpose;
  to_masked: string; content_fp: string; provider_sid: string | null; provider_code: number | null; status: ClaimState;
}
export type Result =
  | { ok: true; status: 200; result: "sent" | "simulated"; sid?: string }
  | { ok: false; status: 400 | 401 | 403 | 409 | 422 | 502; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const no = (status: 400 | 401 | 403 | 409 | 422 | 502, reason: string): Result => ({ ok: false, status, reason });
export const maskPhone = (e: string) => (e.length > 6 ? `${e.slice(0, 3)}****${e.slice(-2)}` : "****");

export async function guardedSend(identity: Identity, req: SendRequest, d: Deps): Promise<Result> {
  if (identity.kind === "anonymous") return no(401, "unauthenticated");
  if (req.test !== undefined && req.test !== false && req.test !== true) return no(400, "invalid_test_flag");
  const kind = req.test === true ? "test" : typeof req.kind === "string" ? req.kind : "";
  if (typeof req.message !== "string" || !req.message || req.message.length > 1600) return no(400, "invalid_message");
  const customerId = req.customer_id == null ? null : String(req.customer_id);
  const appointmentId = req.appointment_id == null ? null : String(req.appointment_id);
  if ((customerId && !UUID.test(customerId)) || (appointmentId && !UUID.test(appointmentId))) return no(400, "invalid_reference");

  // Resolve the referenced rows first (pure reads), so tenant and recipient come from data.
  const appt = appointmentId ? await d.appointment(appointmentId) : null;
  if (appointmentId && !appt) return no(403, "appointment_not_found");
  const resolvedCustomerId = customerId ?? appt?.customer_id ?? null;
  if (!resolvedCustomerId) return no(422, "recipient_unverified");
  if (customerId && appt?.customer_id && appt.customer_id !== customerId) return no(403, "appointment_customer_mismatch");
  if (appointmentId && !appt?.customer_id) return no(422, "appointment_without_customer");
  const customer = await d.customer(resolvedCustomerId);
  if (!customer || !customer.user_id) return no(403, "customer_not_found");

  // Tenant + purpose
  let tenantId: string; let purpose: MessagePurpose;
  if (identity.kind === "service") {
    if (req.test === true) return no(403, "test_not_allowed_for_service");
    const p = SERVICE_KINDS[identity.caller]?.[kind];
    if (!p) return no(403, "kind_not_allowed_for_caller");
    purpose = p;
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

  // Recipient: the customer's own normalised phone. A given `to` must match it.
  const dest = normalizeE164(customer.phone);
  if (!dest) return no(422, "customer_phone_invalid");
  if (req.to !== undefined) {
    const asked = normalizeE164(req.to);
    if (!asked) return no(422, "invalid_phone");
    if (asked !== dest) return no(422, "phone_mismatch");
  }

  // Consent: STOP first, always.
  const stopped = await d.isStopped(tenantId, dest);
  if (stopped) return no(409, "customer_stopped");
  const pref = await d.preferenceWhatsappOptOut(tenantId, customer.id);
  const c = evaluateWhatsAppConsent({ purpose, tenantId, customer, stoppedInTenant: stopped, preferenceWhatsappOptOut: pref });
  if (c.allowed === false) return no(409, c.reason);
  if (kind !== "test" && !(await d.whatsappEnabled(tenantId))) return no(409, "whatsapp_disabled");

  // Claim bound to the full intended send.
  const slot = typeof req.idempotency_key === "string" && /^[A-Za-z0-9_.:-]{8,128}$/.test(req.idempotency_key)
    ? `k:${req.idempotency_key}`
    : `n:${kind}|${appointmentId ?? "-"}|${customer.id}|${typeof req.reminder_type === "string" ? req.reminder_type : "-"}${appointmentId ? "" : "|" + (await d.hmac("content", req.message))}`;
  const key = await d.hmac("claim", `${tenantId}|${slot}`);
  const contentFp = await d.hmac("content", req.message);
  const fingerprint = await d.hmac("fp", [tenantId, kind, purpose, customer.id, appointmentId ?? "-", dest, contentFp].join("|"));
  const claim = await d.claim(tenantId, key, fingerprint);
  if (claim.created === false) {
    if (claim.fingerprint !== fingerprint) return no(409, "idempotency_conflict");
    if (claim.state === "sent") return no(409, "duplicate");
    if (claim.state === "failed") return no(409, "previous_attempt_failed_needs_new_key");
    return no(409, "outcome_unknown");
  }
  const base = { tenant_id: tenantId, customer_id: customer.id, appointment_id: appointmentId, kind, purpose,
    to_masked: maskPhone(dest), content_fp: contentFp };

  if (await d.isDemoTenant(tenantId)) {
    await d.finalize(tenantId, key, "sent", { ...base, provider_sid: null, provider_code: null, status: "sent" });
    return { ok: true, status: 200, result: "simulated" };
  }

  let r: { accepted: boolean; sid?: string; code?: number };
  try { r = await d.transport(dest, req.message); }
  catch {
    await d.finalize(tenantId, key, "unknown", { ...base, provider_sid: null, provider_code: null, status: "unknown" }).catch(() => {});
    return no(502, "outcome_unknown");
  }
  const state: ClaimState = r.accepted ? "sent" : "failed";
  // If finalize fails the claim stays "claimed" and every retry answers outcome_unknown.
  await d.finalize(tenantId, key, state, { ...base, provider_sid: r.sid ?? null,
    provider_code: typeof r.code === "number" ? r.code : null, status: state }).catch(() => {});
  return r.accepted ? { ok: true, status: 200, result: "sent", sid: r.sid } : no(502, "provider_rejected");
}
