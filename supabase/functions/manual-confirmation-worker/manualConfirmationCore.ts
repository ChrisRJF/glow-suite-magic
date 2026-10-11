// INACTIVE prepared core: confirmation email after a manual agenda appointment.
// Not imported by src/ or any Edge Function entrypoint. Pure: all reads, the claim and the
// send are injected, so this module cannot send or write anything by itself.
//
// Runs SERVER-SIDE only (future Edge Function `manual-booking-confirmation`), called by the
// agenda AFTER create_appointment_atomic answered ok. The browser sends ONLY the appointment id
// and the "send" choice. Salon, recipient, service, employee and time are read on the server.

import { buildCustomerEmailLinks } from "./emailLinks.ts";

export const CONFIRM_ROLES = new Set(["eigenaar", "admin", "manager", "receptie"]);

export type SkipReason =
  | "not_requested" | "not_authenticated" | "forbidden" | "not_found" | "incomplete" | "cancelled"
  | "no_email" | "demo" | "opted_out" | "paused" | "unknown_time" | "already_sent" | "send_failed"
  | "not_manual" | "status_not_allowed" | "payment_not_allowed" | "renderer_unsafe" | "recipient_not_allowed"
  // Temporary/technical: never a final skip, never counted as a customer opt-out.
  | "consent_unreadable" | "controls_unreadable"
  // Provider outcome unknown (network loss, timeout, 5xx, unreadable answer): NOT sent, NOT final success.
  | "send_uncertain";

/** Allow-list (fail closed): anything else, incl. cancelled/no-show/pending holdings, gets no mail. */
export const ALLOWED_STATUSES = new Set(["gepland", "bevestigd", "confirmed", "geboekt"]);
/** Allow-list for payment state; pending/open/failed/expired/canceled/refunded holdings are refused. */
export const ALLOWED_PAYMENT_STATUSES = new Set(["", "unpaid", "none", "paid"]);

export interface StoredAppointment {
  id: string; user_id: string; is_demo: boolean; status: string; source: string | null;
  customer_id: string | null; service_id: string | null; appointment_date: string;
  start_time: string | null; end_time: string | null; booking_token: string | null;
  booking_reference: string | null; payment_status: string | null;
}

export interface Deps {
  verifyUser: (jwt: string) => Promise<string | null>;
  tenantForUser: (userId: string) => Promise<{ tenantId: string; isDemo: boolean } | null>;
  rolesForUser: (userId: string) => Promise<string[] | null>;
  /** Reads with service role, filtered on id AND tenant; returns null when not that salon's. */
  loadAppointment: (tenantId: string, appointmentId: string) => Promise<StoredAppointment | null>;
  loadEmployeeLinks: (appointmentId: string, tenantId: string) => Promise<{ employee_id: string; is_primary: boolean; name: string | null }[]>;
  loadCustomer: (tenantId: string, customerId: string) => Promise<{ name: string | null; email: string | null; language: string | null } | null>;
  loadService: (tenantId: string, serviceId: string) => Promise<{ name: string } | null>;
  loadSalon: (tenantId: string) => Promise<{ salon_name: string | null; public_slug: string | null; demo_mode: boolean | null; is_demo: boolean | null } | null>;
  /** Existing customer_message_preferences: false = customer opted out of email. Missing = allowed (transactional). */
  emailAllowed: (tenantId: string, customerId: string) => Promise<boolean>;
  /** Existing customer_email_controls stop switch, fail closed. */
  sendingAllowed: () => Promise<boolean>;
  /** Atomic claim on the idempotency key (unique insert). false = already claimed. */
  claim: (key: string) => Promise<boolean>;
  /** Existing send-white-label-email path (service caller, template booking_confirmation). */
  /** ok=true only on a confirmed success. uncertain=true when the mail may or may not have left. */
  send: (payload: Record<string, unknown>) => Promise<{ ok: boolean; uncertain?: boolean }>;
  release: (key: string) => Promise<void>;
  /** Test phase: only explicitly allowed test addresses (exact, lowercased). Empty/missing = nobody (fail closed).
   *  Full activation replaces this with an explicit "all recipients" decision, never by default. */
  allowedRecipients: ReadonlySet<string> | "all";
  /** true only once the template diff in bookingConfirmationManageAction.ts is live in the renderer. */
  rendererTokenOnlyManageLink: boolean;
}

export type Result = { sent: true; key: string } | { sent: false; reason: SkipReason };

const skip = (reason: SkipReason): Result => ({ sent: false, reason });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Real UTC -> Amsterdam date/time, only when it matches the stored start_time (never guessed). */
export function amsterdamSlot(appointmentDate: string, startTime: string | null): { date: string; time: string } | null {
  const d = new Date(appointmentDate);
  const st = (startTime || "").slice(0, 5);
  if (Number.isNaN(d.getTime()) || !st) return null;
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).reduce<Record<string, string>>((a, x) => { a[x.type] = x.value; return a; }, {});
  return `${p.hour}:${p.minute}` === st ? { date: `${p.year}-${p.month}-${p.day}`, time: st } : null;
}

export async function dispatchManualConfirmation(
  req: { jwt: string | null; appointmentId: string; sendToCustomer: boolean },
  deps: Deps,
): Promise<Result> {
  if (req.sendToCustomer !== true) return skip("not_requested");
  if (!req.jwt) return skip("not_authenticated");
  const userId = await deps.verifyUser(req.jwt);
  if (!userId) return skip("not_authenticated");
  const tenant = await deps.tenantForUser(userId);
  const roles = await deps.rolesForUser(userId);
  if (!tenant || !roles || !roles.some((r) => CONFIRM_ROLES.has(r))) return skip("forbidden");

  return sendForTenant(tenant, req.appointmentId, deps);
}

/** All checks after authentication. Used by the direct route and by the outbox worker. */
export async function sendForTenant(
  tenant: { tenantId: string; isDemo: boolean }, appointmentId: string,
  deps: Omit<Deps, "verifyUser" | "tenantForUser" | "rolesForUser">,
): Promise<Result> {
  const apt = await deps.loadAppointment(tenant.tenantId, appointmentId);
  if (!apt || apt.user_id !== tenant.tenantId || apt.is_demo !== tenant.isDemo) return skip("not_found");
  if (apt.source !== "manual") return skip("not_manual");
  const status = (apt.status || "").trim().toLowerCase();
  if (["geannuleerd", "cancelled", "canceled"].includes(status)) return skip("cancelled");
  if (!ALLOWED_STATUSES.has(status)) return skip("status_not_allowed");
  if (!ALLOWED_PAYMENT_STATUSES.has((apt.payment_status || "").trim().toLowerCase())) return skip("payment_not_allowed");
  if (!apt.customer_id || !apt.service_id || !apt.start_time || !apt.end_time) return skip("incomplete");

  const salon = await deps.loadSalon(tenant.tenantId);
  if (!salon) return skip("not_found");
  if (apt.is_demo || salon.is_demo || salon.demo_mode) return skip("demo");

  const [customer, service, links] = await Promise.all([
    deps.loadCustomer(tenant.tenantId, apt.customer_id),
    deps.loadService(tenant.tenantId, apt.service_id),
    deps.loadEmployeeLinks(apt.id, tenant.tenantId),
  ]);
  if (!customer || !service) return skip("incomplete");
  const email = (customer.email || "").trim().toLowerCase();
  if (!EMAIL.test(email)) return skip("no_email");
  const allow = deps.allowedRecipients;
  if (allow !== "all" && !(allow instanceof Set && allow.has(email))) return skip("recipient_not_allowed");
  // A read error is technical (retry later); only an explicit false is a real customer opt-out.
  const consent = await deps.emailAllowed(tenant.tenantId, apt.customer_id).then((v) => v === true ? "yes" : "no", () => "err");
  if (consent === "err") return skip("consent_unreadable");
  if (consent === "no") return skip("opted_out");
  const sending = await deps.sendingAllowed().then((v) => v === true ? "yes" : "no", () => "err");
  if (sending === "err") return skip("controls_unreadable");
  if (sending === "no") return skip("paused");

  if (deps.rendererTokenOnlyManageLink !== true) return skip("renderer_unsafe");

  const slot = amsterdamSlot(apt.appointment_date, apt.start_time);
  if (!slot) return skip("unknown_time");

  const key = `manual-booking-confirmation-${apt.id}`;
  if (!(await deps.claim(key))) return skip("already_sent");

  const primary = links.find((l) => l.is_primary) ?? links[0];
  const { manageUrl } = buildCustomerEmailLinks({ publicSlug: salon.public_slug, bookingToken: apt.booking_token });
  const res = await deps.send({
    template_key: "booking_confirmation",
    user_id: tenant.tenantId,
    recipient_email: email,
    recipient_name: customer.name ?? "",
    idempotency_key: key,
    // Same From as the public booking_confirmation: normal public_slug, NO sender_legacy_name_id.
    salon_slug: salon.public_slug ?? undefined,
    salon_name: salon.salon_name ?? undefined,
    language: customer.language ?? undefined,
    template_data: {
      customer_name: customer.name ?? "",
      date: slot.date,
      time: slot.time,
      service_name: service.name,
      employee: primary?.name ?? undefined,
      reference: apt.booking_reference ?? undefined,
      ...(manageUrl ? { manage_url: manageUrl } : {}), // only with a valid token, never invented
    },
  }).catch(() => ({ ok: false, uncertain: true }));
  if (res.ok === true && res.uncertain !== true) return { sent: true, key };
  if (res.uncertain === true) return skip("send_uncertain"); // keep the claim: never silently resend or mark sent
  await deps.release(key).catch(() => {}); return skip("send_failed");
}
