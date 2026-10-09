// INACTIVE (round 8A). Proposed security pipeline for a future whatsapp-send.
// Not imported by any entrypoint. All I/O is injected so it can be tested with
// mocks only; no network, no database, no provider calls happen in this file.
//
// Order of checks (each step fails closed):
//   1. identity      verified server-side (JWT / service secret), never body fields
//   2. tenant        user: own tenant via membership; service: tenant derived from
//                    the referenced appointment/customer row, must equal body user_id
//   3. role          user: allowed roles per message kind; test only owner/admin
//   4. ownership     customer and appointment must belong to the tenant
//   5. consent       explicit opt-in, per-salon STOP, blocked/archived, marketing
//   6. claim         durable idempotency claim BEFORE the provider call
//   7. transport     provider call (mocked in tests)
//   8. finalize      claim -> sent | failed | unknown, minimised log record

import { evaluateWhatsAppConsent, type MessagePurpose } from "./whatsappConsent.ts";

export type Identity =
  | { kind: "anonymous" }
  | { kind: "service"; caller: ServiceCaller }
  | { kind: "user"; userId: string };

/** Internal callers must name themselves; each is bound to a fixed set of kinds. */
export type ServiceCaller =
  | "reminder-scheduler" | "automation-scheduler" | "auto-rebook" | "booking-confirmation"
  | "payment-webhook" | "customer-forms";

export type Role = "eigenaar" | "admin" | "manager" | "medewerker" | "financieel" | "receptie";

export const KIND_PURPOSE: Record<string, MessagePurpose> = {
  reminder: "transactional", booking_confirmation: "transactional", payment_link: "transactional",
  form_request: "transactional", waitlist_offer: "transactional", rebook: "marketing",
  campaign: "marketing", automation: "marketing", manual: "transactional", test: "transactional",
};

const SERVICE_KINDS: Record<ServiceCaller, string[]> = {
  "reminder-scheduler": ["reminder"],
  "automation-scheduler": ["automation"],
  "auto-rebook": ["rebook"],
  "booking-confirmation": ["booking_confirmation"],
  "payment-webhook": ["payment_link", "booking_confirmation"],
  "customer-forms": ["form_request"],
};

const USER_KINDS: Record<string, Role[]> = {
  manual: ["eigenaar", "admin", "manager", "receptie"],
  waitlist_offer: ["eigenaar", "admin", "manager", "receptie"],
  campaign: ["eigenaar", "admin", "manager"],
  test: ["eigenaar", "admin"],
};

export interface SendRequest {
  user_id?: unknown; to?: unknown; message?: unknown; kind?: unknown; test?: unknown;
  customer_id?: unknown; appointment_id?: unknown; reminder_type?: unknown;
  idempotency_key?: unknown; confirmation_link?: unknown; booking_token?: unknown;
}

export interface CustomerRow {
  id: string; user_id: string | null; phone: string | null;
  whatsapp_opt_in: boolean | null; marketing_opt_in: boolean | null;
  archived_at: string | null; pseudonymized_at: string | null; communication_blocked_at: string | null;
}

export type ClaimState = "claimed" | "sent" | "failed" | "unknown";

export interface Deps {
  /** Active membership role of userId in tenant (owner = eigenaar). null = none/revoked/ambiguous. */
  roleInTenant(userId: string, tenantId: string): Promise<Role | null>;
  /** Single tenant of a member (current_tenant_id semantics). */
  tenantOfUser(userId: string): Promise<string | null>;
  customer(id: string): Promise<CustomerRow | null>;
  appointmentOwner(id: string): Promise<{ user_id: string; customer_id: string | null } | null>;
  isStopped(tenantId: string, phoneE164: string): Promise<boolean>;
  whatsappEnabled(tenantId: string): Promise<boolean>;
  isDemoTenant(tenantId: string): Promise<boolean>;
  /** Atomic insert-if-absent. Returns existing state when the key is already claimed. */
  claim(key: string, tenantId: string): Promise<{ created: true } | { created: false; state: ClaimState }>;
  finalize(key: string, state: ClaimState, log: MinimalLog): Promise<void>;
  transport(to: string, body: string): Promise<{ accepted: boolean; sid?: string; code?: number }>;
  hash(s: string): Promise<string>;
}

export interface MinimalLog {
  tenant_id: string; customer_id: string | null; appointment_id: string | null; kind: string;
  to_masked: string; message_hash: string; provider_sid: string | null; provider_code: number | null;
  status: ClaimState;
}

export type Result =
  | { ok: true; status: 200; result: "sent" | "simulated"; sid?: string }
  | { ok: false; status: 400 | 401 | 403 | 409 | 422 | 502; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const no = (status: 400 | 401 | 403 | 409 | 422 | 502, reason: string): Result => ({ ok: false, status, reason });

export function maskPhone(e164: string): string {
  return e164.length > 6 ? `${e164.slice(0, 3)}****${e164.slice(-2)}` : "****";
}

export async function guardedSend(identity: Identity, req: SendRequest, d: Deps): Promise<Result> {
  // 1. identity
  if (identity.kind === "anonymous") return no(401, "unauthenticated");
  const kind = typeof req.kind === "string" ? req.kind : "manual";
  if (!(kind in KIND_PURPOSE)) return no(400, "unknown_kind");
  if (typeof req.to !== "string" || !E164.test(req.to)) return no(400, "invalid_phone");
  if (typeof req.message !== "string" || !req.message || req.message.length > 1600) return no(400, "invalid_message");
  const customerId = req.customer_id == null ? null : String(req.customer_id);
  const appointmentId = req.appointment_id == null ? null : String(req.appointment_id);
  if ((customerId && !UUID.test(customerId)) || (appointmentId && !UUID.test(appointmentId))) return no(400, "invalid_reference");
  if (req.test !== undefined && req.test !== false && req.test !== true) return no(400, "invalid_test_flag");
  const test = req.test === true;

  // 2+3. tenant and role
  let tenantId: string;
  if (identity.kind === "service") {
    if (test) return no(403, "test_not_allowed_for_service");
    if (!SERVICE_KINDS[identity.caller]?.includes(kind)) return no(403, "kind_not_allowed_for_caller");
    // Tenant is derived from data, never from the body alone.
    const appt = appointmentId ? await d.appointmentOwner(appointmentId) : null;
    const cust = customerId ? await d.customer(customerId) : null;
    if (!appt && !cust) return no(403, "service_requires_owned_reference");
    if (appointmentId && !appt) return no(403, "appointment_not_found");
    if (customerId && !cust) return no(403, "customer_not_found");
    const owners = new Set([appt?.user_id, cust?.user_id].filter(Boolean));
    if (owners.size !== 1) return no(403, "reference_tenant_mismatch");
    tenantId = [...owners][0] as string;
    if (req.user_id !== undefined && req.user_id !== tenantId) return no(403, "body_tenant_mismatch");
  } else {
    const own = await d.tenantOfUser(identity.userId);
    if (!own) return no(403, "no_tenant");
    if (req.user_id !== undefined && req.user_id !== own) return no(403, "body_tenant_mismatch");
    tenantId = own;
    const role = await d.roleInTenant(identity.userId, tenantId);
    if (!role) return no(403, "not_member_of_tenant");
    const effectiveKind = test ? "test" : kind;
    if (!USER_KINDS[effectiveKind]?.includes(role)) return no(403, "role_not_allowed");
    if (!test && !customerId) return no(422, "customer_required");
  }

  // 4. ownership (applies to everyone, including test sends)
  let customer: CustomerRow | null = null;
  if (customerId) {
    customer = await d.customer(customerId);
    if (!customer || customer.user_id !== tenantId) return no(403, "customer_not_in_tenant");
    if (customer.phone !== req.to) return no(422, "phone_mismatch");
  }
  if (appointmentId) {
    const a = await d.appointmentOwner(appointmentId);
    if (!a || a.user_id !== tenantId) return no(403, "appointment_not_in_tenant");
    if (customerId && a.customer_id && a.customer_id !== customerId) return no(403, "appointment_customer_mismatch");
  }

  // 5. consent. STOP is checked by number so test sends cannot bypass it either.
  const stopped = await d.isStopped(tenantId, req.to);
  if (stopped) return no(409, "customer_stopped");
  if (customer) {
    const c = evaluateWhatsAppConsent({ purpose: KIND_PURPOSE[kind], tenantId, customer, stoppedInTenant: stopped });
    if (!c.allowed) return no(409, c.reason);
  }
  if (!test && !(await d.whatsappEnabled(tenantId))) return no(409, "whatsapp_disabled");

  // 6. claim before any provider call
  const natural = [tenantId, kind, appointmentId ?? "-", customerId ?? "-",
    typeof req.reminder_type === "string" ? req.reminder_type : "-",
    typeof req.idempotency_key === "string" ? req.idempotency_key : await d.hash(req.message)].join("|");
  const key = await d.hash(natural);
  const claim = await d.claim(key, tenantId);
  if (!claim.created) {
    // sent: already delivered to provider. claimed/unknown: outcome uncertain, never auto-resend.
    if (claim.state === "failed") return no(409, "previous_attempt_failed_needs_new_key");
    return no(409, claim.state === "sent" ? "duplicate" : "outcome_unknown");
  }
  const base = {
    tenant_id: tenantId, customer_id: customerId, appointment_id: appointmentId, kind,
    to_masked: maskPhone(req.to), message_hash: await d.hash(req.message),
  };

  if (await d.isDemoTenant(tenantId)) {
    await d.finalize(key, "sent", { ...base, provider_sid: null, provider_code: null, status: "sent" });
    return { ok: true, status: 200, result: "simulated" };
  }

  // 7. transport. A throw here means the outcome is unknown (provider may have accepted).
  let r: { accepted: boolean; sid?: string; code?: number };
  try {
    r = await d.transport(req.to, req.message);
  } catch {
    await d.finalize(key, "unknown", { ...base, provider_sid: null, provider_code: null, status: "unknown" }).catch(() => {});
    return no(502, "outcome_unknown");
  }

  // 8. finalize. If this write fails the claim stays "claimed" = treated as unknown on retry.
  const state: ClaimState = r.accepted ? "sent" : "failed";
  try {
    await d.finalize(key, state, { ...base, provider_sid: r.sid ?? null, provider_code: r.code ?? null, status: state });
  } catch {
    return r.accepted ? { ok: true, status: 200, result: "sent", sid: r.sid } : no(502, "provider_rejected");
  }
  return r.accepted ? { ok: true, status: 200, result: "sent", sid: r.sid } : no(502, "provider_rejected");
}
