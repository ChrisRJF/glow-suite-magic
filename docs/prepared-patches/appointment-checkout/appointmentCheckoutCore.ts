// INACTIVE prepared core: "Afrekenen" from an agenda appointment.
// Not imported by src/ or any Edge Function. Pure: all reads and the provider start are injected,
// so this module cannot write a payment, mark anything paid or touch total_spent.
//
// Runs SERVER-SIDE only (future Edge Function `appointment-checkout`). The browser sends ONLY
// appointment_id, method ("terminal" | "link") and, for terminal, terminal_id + tip.
// Amount, salon, customer and outstanding balance are computed here from stored rows.

export const CHECKOUT_ROLES = new Set(["eigenaar", "admin", "manager", "receptie"]);

/** Payment row states. Only provider-confirmed "paid" counts as money received. */
export const CONFIRMED = new Set(["paid"]);
export const IN_FLIGHT = new Set(["pending", "open", "processing", "sent_to_terminal", "waiting_customer", "authorized"]);
export const BLOCKED_APPOINTMENT = new Set(["geannuleerd", "cancelled", "canceled", "no_show", "no-show"]);
const REFUNDISH = new Set(["refunded", "partially_refunded", "chargeback", "charged_back", "reversed"]);

export interface StoredAppointment {
  id: string; user_id: string; is_demo: boolean; status: string;
  service_id: string | null; customer_id: string | null; total_price: number | null;
}
export interface StoredPayment {
  id: string; appointment_id: string; user_id: string; amount: number;
  status: string; payment_type: string | null; provider: string | null; is_demo: boolean;
}

export type Block =
  | "not_authenticated" | "forbidden" | "not_found" | "cancelled" | "no_price"
  | "already_paid" | "payment_in_progress" | "refund_present" | "provider_not_ready"
  | "provider_error" | "duplicate" | "invalid_method";

export interface Deps {
  verifyUser: (jwt: string) => Promise<string | null>;
  tenantForUser: (userId: string) => Promise<{ tenantId: string; isDemo: boolean } | null>;
  rolesForUser: (userId: string) => Promise<string[] | null>;
  /** Service-role read filtered on id AND tenant. */
  loadAppointment: (tenantId: string, id: string) => Promise<StoredAppointment | null>;
  /** Current service price of the SAME salon; used only when total_price is empty. */
  loadServicePrice: (tenantId: string, serviceId: string) => Promise<number | null>;
  loadPayments: (tenantId: string, appointmentId: string) => Promise<StoredPayment[] | null>;
  /** Existing readiness (viva_status active + live enabled, or terminal active). No invented config. */
  providerReady: (tenantId: string, method: "terminal" | "link", isDemo: boolean) => Promise<boolean>;
  /** Unique claim on idempotency key (DB unique index in the proposal). false = already claimed. */
  claim: (key: string) => Promise<boolean>;
  release: (key: string) => Promise<void>;
  /** Existing create-viva-terminal-payment / create-viva-payment, called server-side with the server amount. */
  startProvider: (args: { method: "terminal" | "link"; tenantId: string; appointmentId: string; customerId: string | null;
    amountCents: number; tipCents: number; idempotencyKey: string; terminalId?: string; isDemo: boolean })
    => Promise<{ ok: true; paymentId: string; checkoutUrl?: string | null } | { ok: false }>;
}

export type Result =
  | { started: true; paymentId: string; amountCents: number; checkoutUrl: string | null; state: "waiting_provider" }
  | { started: false; block: Block; existingPaymentId?: string };

const cents = (n: unknown) => Math.round((Number(n) || 0) * 100);

/** Outstanding = price minus provider-confirmed payments of this salon/appointment. Never trusts amount_paid. */
export function outstanding(apt: StoredAppointment, priceEuro: number, payments: StoredPayment[]) {
  const own = payments.filter((p) => p.appointment_id === apt.id && p.user_id === apt.user_id && p.is_demo === apt.is_demo);
  const paidCents = own.filter((p) => CONFIRMED.has(p.status)).reduce((s, p) => s + cents(p.amount), 0);
  const inFlight = own.find((p) => IN_FLIGHT.has(p.status));
  const refund = own.some((p) => REFUNDISH.has(p.status));
  return { priceCents: cents(priceEuro), paidCents, dueCents: Math.max(0, cents(priceEuro) - paidCents), inFlight, refund };
}

export async function startAppointmentCheckout(
  req: { jwt: string | null; appointmentId: string; method: string; terminalId?: string; tipCents?: number },
  deps: Deps,
): Promise<Result> {
  const no = (block: Block, existingPaymentId?: string): Result => ({ started: false, block, ...(existingPaymentId ? { existingPaymentId } : {}) });
  if (req.method !== "terminal" && req.method !== "link") return no("invalid_method");
  if (req.method === "terminal" && !req.terminalId) return no("invalid_method");
  if (!req.jwt) return no("not_authenticated");
  const userId = await deps.verifyUser(req.jwt);
  if (!userId) return no("not_authenticated");
  const tenant = await deps.tenantForUser(userId);
  const roles = await deps.rolesForUser(userId);
  if (!tenant || !roles || !roles.some((r) => CHECKOUT_ROLES.has(r))) return no("forbidden");

  const apt = await deps.loadAppointment(tenant.tenantId, req.appointmentId);
  if (!apt || apt.user_id !== tenant.tenantId || apt.is_demo !== tenant.isDemo) return no("not_found");
  if (BLOCKED_APPOINTMENT.has((apt.status || "").toLowerCase())) return no("cancelled");

  const price = apt.total_price != null && Number(apt.total_price) > 0
    ? Number(apt.total_price)
    : apt.service_id ? await deps.loadServicePrice(tenant.tenantId, apt.service_id) : null;
  if (!price || price <= 0) return no("no_price");

  const payments = await deps.loadPayments(tenant.tenantId, apt.id);
  if (!payments) return no("provider_error"); // unreadable = fail closed
  const o = outstanding(apt, price, payments);
  if (o.refund) return no("refund_present"); // never re-book around refunds without separate approval
  if (o.inFlight) return no("payment_in_progress", o.inFlight.id);
  if (o.dueCents <= 0) return no("already_paid");

  const method = req.method as "terminal" | "link";
  if (!(await deps.providerReady(tenant.tenantId, method, apt.is_demo).catch(() => false))) return no("provider_not_ready");

  // Key changes only after a confirmed payment, so retries/double clicks reuse the same key.
  const key = `appt-checkout-${apt.id}-${o.paidCents}`;
  if (!(await deps.claim(key))) return no("duplicate");

  const tip = method === "terminal" ? Math.max(0, Math.min(Math.round(Number(req.tipCents) || 0), o.dueCents)) : 0;
  const res = await deps.startProvider({
    method, tenantId: tenant.tenantId, appointmentId: apt.id, customerId: apt.customer_id,
    amountCents: o.dueCents + tip, tipCents: tip, idempotencyKey: key, terminalId: req.terminalId, isDemo: apt.is_demo,
  }).catch(() => ({ ok: false as const }));
  if (!res.ok || !("paymentId" in res) || !res.paymentId) { await deps.release(key).catch(() => {}); return no("provider_error"); }
  return { started: true, paymentId: res.paymentId, amountCents: o.dueCents + tip, checkoutUrl: res.checkoutUrl ?? null, state: "waiting_provider" };
}

/** UI label mapping. "Betaald" ONLY for a provider-confirmed server status. */
export type UiState = "starten" | "wachten" | "betaald" | "mislukt";
export function uiStateFromServer(status: string | null | undefined): UiState {
  const s = (status || "").toLowerCase();
  if (s === "paid") return "betaald";
  if (["failed", "cancelled", "canceled", "expired", "payment_failed"].includes(s)) return "mislukt";
  if (!s) return "starten";
  return "wachten";
}
