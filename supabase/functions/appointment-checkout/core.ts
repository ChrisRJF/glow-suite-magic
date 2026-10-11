// "Afrekenen" vanuit een agenda-afspraak (Edge Function appointment-checkout, gated per salon by appointment_checkout_enabled).
// Pure server logic: every read/write is injected. It never marks anything paid and never touches total_spent.
// Truth for "paid" = public.payment_ledger (service-role only, written by record_provider_payment after a
// verified Viva/Mollie confirmation). A payments row with status 'paid' is NOT proof (client-writable).

export const CHECKOUT_ROLES = new Set(["eigenaar", "admin", "manager", "receptie"]);
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
  is_demo: boolean; refunded_amount: number | null; refunded_at: string | null; checkout_url?: string | null;
}
export interface LedgerRow { payment_id: string; tenant_id: string; appointment_id: string | null; kind: "payment" | "refund"; amount_cents: number; currency: string }

export type Block =
  | "not_authenticated" | "forbidden" | "disabled" | "not_found" | "cancelled" | "no_price" | "group_booking"
  | "price_inconsistent" | "already_paid" | "payment_in_progress" | "link_open" | "refund_present"
  | "unverified_payment" | "uncertain_status" | "provider_not_ready" | "provider_error" | "duplicate" | "invalid_method";

export const MESSAGES: Record<Block, string> = {
  not_authenticated: "Je bent uitgelogd. Log opnieuw in.",
  forbidden: "Je hebt geen rechten om af te rekenen in deze salon.",
  disabled: "Afrekenen vanuit de agenda staat nog niet aan voor deze salon.",
  not_found: "Deze afspraak is niet gevonden in jouw salon.",
  cancelled: "Deze afspraak is geannuleerd of als niet verschenen gemarkeerd. Afrekenen is niet mogelijk.",
  no_price: "Deze afspraak heeft geen vastgelegde prijs. Pas eerst de prijs van de afspraak aan.",
  group_booking: "Groepsafspraken kunnen nog niet vanuit de agenda worden afgerekend.",
  price_inconsistent: "De aanbetaling past niet bij de prijs van deze afspraak. Controleer de afspraak.",
  already_paid: "Deze afspraak is volledig betaald.",
  payment_in_progress: "Er loopt al een betaling voor deze afspraak. Wacht tot die is afgerond.",
  link_open: "Er staat al een betaallink open voor deze afspraak. Wacht tot de klant betaalt of de link verloopt.",
  refund_present: "Voor deze afspraak is een terugbetaling geregistreerd. Afrekenen is geblokkeerd tot dit is gecontroleerd.",
  unverified_payment: "Er staat een betaling bij deze afspraak die niet door de betaalprovider is bevestigd. Controleer dit eerst.",
  uncertain_status: "De betaalstatus van deze afspraak is onduidelijk. Er is niets gestart.",
  provider_not_ready: "Het pinapparaat of de betaallink is nog niet ingesteld voor deze salon.",
  provider_error: "De betaalprovider reageerde niet goed. Er is niets afgeschreven. Probeer het opnieuw.",
  duplicate: "Deze betaling wordt al gestart. Even geduld.",
  invalid_method: "Kies pinapparaat of betaallink.",
};

export interface Deps {
  verifyUser: (jwt: string) => Promise<string | null>;
  tenantForUser: (userId: string) => Promise<{ tenantId: string; isDemo: boolean; role: string } | null>;
  flagEnabled: (tenantId: string) => Promise<boolean>;
  loadAppointment: (tenantId: string, id: string) => Promise<StoredAppointment | null>;
  loadPayments: (tenantId: string, appointmentId: string) => Promise<StoredPayment[] | null>;
  loadLedger: (tenantId: string, appointmentId: string) => Promise<LedgerRow[] | null>;
  providerReady: (tenantId: string, method: "terminal" | "link", isDemo: boolean) => Promise<boolean>;
  claim: (key: string, tenantId: string, appointmentId: string) => Promise<boolean>;
  attach: (key: string, paymentId: string) => Promise<void>;
  release: (key: string) => Promise<void>;
  startProvider: (args: { method: "terminal" | "link"; tenantId: string; appointmentId: string; customerId: string | null;
    amountCents: number; idempotencyKey: string; terminalId?: string; isDemo: boolean })
    => Promise<{ ok: true; paymentId: string; checkoutUrl?: string | null } | { ok: false; definitive: boolean }>;
}

export interface Quote { priceCents: number; paidCents: number; dueCents: number }
export type Result =
  | { ok: true; quote: Quote; started?: { paymentId: string; amountCents: number; checkoutUrl: string | null } }
  | { ok: false; block: Block; message: string; quote?: Quote };

const cents = (n: unknown) => Math.round((Number(n) || 0) * 100);

/** Fail closed. Paid = sum of ledger payments; any refund, in-flight row or unexplained paid row blocks. */
export function computeQuote(apt: StoredAppointment, payments: StoredPayment[], ledger: LedgerRow[]):
  { ok: true; quote: Quote } | { ok: false; block: Block } {
  const priceCents = cents(apt.price);
  for (const l of ledger) {
    if (l.tenant_id !== apt.user_id || l.appointment_id !== apt.id || l.currency !== "EUR" || !(l.amount_cents > 0)) return { ok: false, block: "uncertain_status" };
    if (l.kind === "refund") return { ok: false, block: "refund_present" };
  }
  const ledgerByPayment = new Map<string, number>();
  for (const l of ledger) ledgerByPayment.set(l.payment_id, (ledgerByPayment.get(l.payment_id) ?? 0) + l.amount_cents);
  let paidCents = 0;
  for (const p of payments) {
    if (p.appointment_id !== apt.id || p.user_id !== apt.user_id || p.is_demo !== apt.is_demo) return { ok: false, block: "uncertain_status" };
    const st = (p.status || "").toLowerCase();
    const proven = ledgerByPayment.get(p.id);
    if (REFUNDISH.has(st) || Number(p.refunded_amount || 0) > 0 || p.refunded_at) return { ok: false, block: "refund_present" };
    if (proven !== undefined) {
      if (proven !== cents(p.amount)) return { ok: false, block: "uncertain_status" };
      paidCents += proven; continue;
    }
    if (st === "paid") return { ok: false, block: "unverified_payment" };
    if (IN_FLIGHT.has(st)) return { ok: false, block: p.checkout_url ? "link_open" : "payment_in_progress" };
    if (DEAD.has(st)) continue; // failed attempt: no money, never erases an earlier proven deposit
    return { ok: false, block: "uncertain_status" };
  }
  for (const id of ledgerByPayment.keys()) if (!payments.some((p) => p.id === id)) return { ok: false, block: "uncertain_status" };
  if (paidCents > priceCents) return { ok: false, block: "price_inconsistent" };
  // A stored amount_paid higher than proven money means an unverified payment was recorded somewhere.
  if (cents(apt.amount_paid) > paidCents) return { ok: false, block: "unverified_payment" };
  return { ok: true, quote: { priceCents, paidCents, dueCents: priceCents - paidCents } };
}

export async function handleCheckout(
  req: { jwt: string | null; action: string; appointmentId: unknown; method?: unknown; terminalId?: unknown },
  deps: Deps,
): Promise<Result> {
  const no = (block: Block, quote?: Quote): Result => ({ ok: false, block, message: MESSAGES[block], ...(quote ? { quote } : {}) });
  if (req.action !== "quote" && req.action !== "start") return no("invalid_method");
  if (typeof req.appointmentId !== "string" || !/^[0-9a-f-]{36}$/i.test(req.appointmentId)) return no("not_found");
  if (!req.jwt) return no("not_authenticated");
  const userId = await deps.verifyUser(req.jwt).catch(() => null);
  if (!userId) return no("not_authenticated");
  const t = await deps.tenantForUser(userId).catch(() => null);
  if (!t || !CHECKOUT_ROLES.has(t.role)) return no("forbidden");
  if (!(await deps.flagEnabled(t.tenantId).catch(() => false))) return no("disabled");

  const apt = await deps.loadAppointment(t.tenantId, req.appointmentId).catch(() => null);
  if (!apt || apt.user_id !== t.tenantId || apt.is_demo !== t.isDemo) return no("not_found");
  if (BLOCKED_APPOINTMENT.has((apt.status || "").toLowerCase())) return no("cancelled");
  if (apt.booking_group_id) return no("group_booking");
  const price = apt.price == null ? NaN : Number(apt.price);
  if (!Number.isFinite(price) || price <= 0) return no("no_price");
  if (apt.deposit_amount != null && (Number(apt.deposit_amount) < 0 || Number(apt.deposit_amount) > price)) return no("price_inconsistent");

  const payments = await deps.loadPayments(t.tenantId, apt.id).catch(() => null);
  const ledger = await deps.loadLedger(t.tenantId, apt.id).catch(() => null);
  if (!payments || !ledger) return no("uncertain_status");
  const q = computeQuote(apt, payments, ledger);
  if (!q.ok) return no(q.block);
  if (q.quote.dueCents <= 0) return no("already_paid", q.quote);
  if (req.action === "quote") return { ok: true, quote: q.quote };

  if (req.method !== "terminal" && req.method !== "link") return no("invalid_method", q.quote);
  const method = req.method;
  const terminalId = typeof req.terminalId === "string" && req.terminalId ? req.terminalId : undefined;
  if (method === "terminal" && (!terminalId || !/^[0-9a-f-]{36}$/i.test(terminalId))) return no("invalid_method", q.quote);
  if (!(await deps.providerReady(t.tenantId, method, apt.is_demo).catch(() => false))) return no("provider_not_ready", q.quote);

  // Same key until a confirmed payment changes paidCents: double clicks and parallel tabs share one claim.
  const key = `appt-checkout-${apt.id}-${q.quote.paidCents}`;
  if (!(await deps.claim(key, t.tenantId, apt.id).catch(() => false))) return no("duplicate", q.quote);

  const res = await deps.startProvider({ method, tenantId: t.tenantId, appointmentId: apt.id, customerId: apt.customer_id,
    amountCents: q.quote.dueCents, idempotencyKey: key, terminalId, isDemo: apt.is_demo })
    .catch(() => ({ ok: false as const, definitive: false }));
  if (!res.ok) {
    // Only a definitive provider refusal frees the claim; an unclear outcome keeps it until it expires.
    if (res.definitive) await deps.release(key).catch(() => {});
    return no("provider_error", q.quote);
  }
  await deps.attach(key, res.paymentId).catch(() => {});
  return { ok: true, quote: q.quote, started: { paymentId: res.paymentId, amountCents: q.quote.dueCents, checkoutUrl: res.checkoutUrl ?? null } };
}
