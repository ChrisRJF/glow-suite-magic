// INACTIVE prepared core: "Afrekenen" from an agenda appointment.
// Not imported by src/ or any Edge Function. Pure: all reads and the provider start are injected,
// so this module cannot write a payment, mark anything paid or touch total_spent.
//
// Runs SERVER-SIDE only (future Edge Function `appointment-checkout`). The browser sends ONLY
// appointment_id, method ("terminal" | "link") and, for terminal, terminal_id + tip.
// Amount, salon, customer and outstanding balance are computed here from stored rows.

export const CHECKOUT_ROLES = new Set(["eigenaar", "admin", "manager", "receptie"]);

/** Payment row states. A "paid" ROW is never proof by itself (KassaPage writes paid rows itself,
 *  and RLS lets salon users insert/update payments incl. provider, metadata, webhook_received_at). */
export const PAID = new Set(["paid"]);
export const IN_FLIGHT = new Set(["pending", "open", "processing", "sent_to_terminal", "waiting_customer", "authorized"]);
export const DEAD = new Set(["failed", "cancelled", "canceled", "expired"]);
export const BLOCKED_APPOINTMENT = new Set(["geannuleerd", "cancelled", "canceled", "no_show", "no-show"]);
const REFUNDISH = new Set(["refunded", "partially_refunded", "chargeback", "charged_back", "reversed"]);

export interface StoredAppointment {
  id: string; user_id: string; is_demo: boolean; status: string;
  customer_id: string | null; price: number | null; deposit_amount: number | null;
  amount_paid: number | null; booking_group_id: string | null;
}
export interface StoredPayment {
  id: string; appointment_id: string; user_id: string; amount: number; status: string;
  payment_type: string | null; provider: string | null; is_demo: boolean;
  refunded_amount: number | null; refunded_at: string | null;
}
/** Evidence ONLY from a service-role-only ledger (not writable by authenticated users).
 *  Today: payment_status_history (poll/webhook, Viva only) has no amount, so amountCents = null. */
export interface ProviderEvidence { paymentId: string; status: "paid"; source: "poll" | "webhook"; provider: "viva" | "mollie"; amountCents: number | null }

export type Block =
  | "not_authenticated" | "forbidden" | "not_found" | "cancelled" | "no_price" | "group_booking" | "price_inconsistent"
  | "already_paid" | "payment_in_progress" | "refund_present" | "unverified_payment" | "uncertain_status"
  | "provider_not_ready" | "provider_error" | "duplicate" | "invalid_method";

export interface Deps {
  verifyUser: (jwt: string) => Promise<string | null>;
  tenantForUser: (userId: string) => Promise<{ tenantId: string; isDemo: boolean } | null>;
  rolesForUser: (userId: string) => Promise<string[] | null>;
  /** Service-role read filtered on id AND tenant. */
  loadAppointment: (tenantId: string, id: string) => Promise<StoredAppointment | null>;
  loadPayments: (tenantId: string, appointmentId: string) => Promise<StoredPayment[] | null>;
  loadEvidence: (tenantId: string, paymentIds: string[]) => Promise<ProviderEvidence[] | null>;
  providerReady: (tenantId: string, method: "terminal" | "link", isDemo: boolean) => Promise<boolean>;
  claim: (key: string) => Promise<boolean>;
  release: (key: string) => Promise<void>;
  startProvider: (args: { method: "terminal" | "link"; tenantId: string; appointmentId: string; customerId: string | null;
    amountCents: number; tipCents: number; idempotencyKey: string; terminalId?: string; isDemo: boolean })
    => Promise<{ ok: true; paymentId: string; checkoutUrl?: string | null } | { ok: false }>;
}

export type Result =
  | { started: true; paymentId: string; amountCents: number; checkoutUrl: string | null; state: "waiting_provider" }
  | { started: false; block: Block; existingPaymentId?: string };

const cents = (n: unknown) => Math.round((Number(n) || 0) * 100);

/** Fail closed: every row must be dead (no money), or VERIFIED paid with a matching evidence amount. */
export function outstanding(apt: StoredAppointment, payments: StoredPayment[], evidence: ProviderEvidence[]):
  { ok: true; priceCents: number; paidCents: number; dueCents: number } | { ok: false; block: Block; id?: string } {
  const priceCents = cents(apt.price);
  let paidCents = 0;
  for (const p of payments) {
    if (p.appointment_id !== apt.id || p.user_id !== apt.user_id || p.is_demo !== apt.is_demo) return { ok: false, block: "uncertain_status", id: p.id };
    const st = (p.status || "").toLowerCase();
    if (REFUNDISH.has(st) || Number(p.refunded_amount || 0) > 0 || p.refunded_at) return { ok: false, block: "refund_present", id: p.id };
    if (IN_FLIGHT.has(st)) return { ok: false, block: "payment_in_progress", id: p.id };
    if (DEAD.has(st)) continue;
    if (!PAID.has(st)) return { ok: false, block: "uncertain_status", id: p.id };
    const ev = evidence.find((e) => e.paymentId === p.id && e.status === "paid");
    if (!ev || ev.amountCents == null || ev.amountCents !== cents(p.amount) || ev.provider !== p.provider) return { ok: false, block: "unverified_payment", id: p.id };
    paidCents += ev.amountCents;
  }
  // amount_paid on the appointment must be explained by verified payments, never trusted alone.
  if (cents(apt.amount_paid) !== paidCents) return { ok: false, block: "unverified_payment" };
  return { ok: true, priceCents, paidCents, dueCents: Math.max(0, priceCents - paidCents) };
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

  if (apt.booking_group_id) return no("group_booking"); // group pricing/sharing: separate design
  const price = apt.price == null ? NaN : Number(apt.price);
  if (!Number.isFinite(price) || price <= 0) return no("no_price"); // never fall back to the current service list
  if (apt.deposit_amount != null && (Number(apt.deposit_amount) < 0 || Number(apt.deposit_amount) > price)) return no("price_inconsistent");

  const payments = await deps.loadPayments(tenant.tenantId, apt.id);
  if (!payments) return no("uncertain_status");
  const evidence = payments.length ? await deps.loadEvidence(tenant.tenantId, payments.map((p) => p.id)).catch(() => null) : [];
  if (!evidence) return no("uncertain_status");
  const o = outstanding(apt, payments, evidence);
  if (!o.ok) return no(o.block, o.id);
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
