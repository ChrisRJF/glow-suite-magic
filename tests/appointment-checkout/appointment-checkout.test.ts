import { describe, it, expect, vi } from "vitest";
import { startAppointmentCheckout, uiStateFromServer, type Deps, type StoredPayment, type ProviderEvidence } from "../../docs/prepared-patches/appointment-checkout/appointmentCheckoutCore";

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
// Stored appointment price 72 (historic discount); the current service list would say 80. Only 72 may be used.
const apt = { id: "apt-1", user_id: T, is_demo: true, status: "gepland", customer_id: "c1", price: 72, deposit_amount: null as number | null, amount_paid: 0, booking_group_id: null as string | null };
const pay = (o: Partial<StoredPayment>): StoredPayment => ({ id: "p1", appointment_id: "apt-1", user_id: T, amount: 20, status: "paid", payment_type: "deposit", provider: "viva", is_demo: true, refunded_amount: 0, refunded_at: null, ...o });
const ev = (o: Partial<ProviderEvidence> = {}): ProviderEvidence => ({ paymentId: "p1", status: "paid", source: "webhook", provider: "viva", amountCents: 2000, ...o });

function mk(over: Partial<Deps> = {}, a: any = apt, payments: StoredPayment[] = [], evidence: ProviderEvidence[] = []) {
  const claimed = new Set<string>();
  const startProvider = vi.fn().mockResolvedValue({ ok: true, paymentId: "new-pay", checkoutUrl: null });
  const deps: Deps = {
    verifyUser: async (j) => (j === "jwt-ok" ? "u1" : null),
    tenantForUser: async () => ({ tenantId: T, isDemo: true }),
    rolesForUser: async () => ["eigenaar"],
    loadAppointment: async (tid, id) => (tid === a.user_id && id === a.id ? a : null),
    loadPayments: async () => payments,
    loadEvidence: async () => evidence,
    providerReady: async () => true,
    claim: async (k) => (claimed.has(k) ? false : (claimed.add(k), true)),
    release: async (k) => { claimed.delete(k); },
    startProvider,
    ...over,
  };
  return { deps, startProvider };
}
const req = { jwt: "jwt-ok", appointmentId: "apt-1", method: "terminal", terminalId: "term-demo" };
const blocked = async (d: ReturnType<typeof mk>, block: string) => {
  expect(await startAppointmentCheckout(req, d.deps)).toMatchObject({ started: false, block });
  expect(d.startProvider).not.toHaveBeenCalled();
};

describe("appointment checkout (fictional demo salon, mocks only, no real payments)", () => {
  it("unpaid: charges the STORED appointment price (72), not the current list price", async () => {
    const d = mk();
    expect(await startAppointmentCheckout(req, d.deps)).toMatchObject({ started: true, amountCents: 7200, state: "waiting_provider" });
  });
  it("missing, zero or invalid stored price: stop, no service-list fallback", async () => {
    for (const price of [null, 0, -5, Number.NaN]) await blocked(mk({}, { ...apt, price }), "no_price");
  });
  it("group booking and deposit larger than price: fail closed", async () => {
    await blocked(mk({}, { ...apt, booking_group_id: "g1" }), "group_booking");
    await blocked(mk({}, { ...apt, deposit_amount: 100 }), "price_inconsistent");
  });
  it("Kassa-style paid row (provider glowpay, no evidence) is NOT deducted: blocked", async () => {
    await blocked(mk({}, { ...apt, amount_paid: 20 }, [pay({ provider: "glowpay" })]), "unverified_payment");
  });
  it("Viva paid row without evidence, or evidence without amount (today's history): blocked", async () => {
    await blocked(mk({}, { ...apt, amount_paid: 20 }, [pay({})], []), "unverified_payment");
    await blocked(mk({}, { ...apt, amount_paid: 20 }, [pay({})], [ev({ amountCents: null })]), "unverified_payment");
  });
  it("Mollie paid row: mollie-webhook writes no protected ledger, so blocked", async () => {
    await blocked(mk({}, { ...apt, amount_paid: 20 }, [pay({ provider: "mollie" })], []), "unverified_payment");
  });
  it("evidence mismatch (amount or provider) blocks", async () => {
    await blocked(mk({}, { ...apt, amount_paid: 20 }, [pay({})], [ev({ amountCents: 1000 })]), "unverified_payment");
    await blocked(mk({}, { ...apt, amount_paid: 20 }, [pay({ provider: "glowpay" })], [ev({})]), "unverified_payment");
  });
  it("verified deposit (future service-only ledger with amount): only remainder 52", async () => {
    const d = mk({}, { ...apt, amount_paid: 20 }, [pay({})], [ev({})]);
    expect(await startAppointmentCheckout(req, d.deps)).toMatchObject({ started: true, amountCents: 5200 });
    expect(d.startProvider.mock.calls[0][0].idempotencyKey).toBe("appt-checkout-apt-1-2000");
  });
  it("appointment amount_paid not explained by verified payments: blocked", async () => {
    await blocked(mk({}, { ...apt, amount_paid: 20 }), "unverified_payment");
  });
  it("fully verified paid: already_paid", async () => {
    await blocked(mk({}, { ...apt, amount_paid: 72 }, [pay({ amount: 72 })], [ev({ amountCents: 7200 })]), "already_paid");
  });
  it("paid row with refunded_amount > 0 or refunded_at, or refund status: blocked", async () => {
    await blocked(mk({}, { ...apt, amount_paid: 20 }, [pay({ refunded_amount: 5 })], [ev({})]), "refund_present");
    await blocked(mk({}, { ...apt, amount_paid: 20 }, [pay({ refunded_at: "2026-10-01T10:00:00Z" })], [ev({})]), "refund_present");
    await blocked(mk({}, apt, [pay({ status: "refunded" })]), "refund_present");
  });
  it("uncertain status, unreadable payments/evidence, in-flight: blocked", async () => {
    await blocked(mk({}, apt, [pay({ status: "unknown_provider_state" })]), "uncertain_status");
    await blocked(mk({ loadPayments: async () => null }), "uncertain_status");
    await blocked(mk({ loadEvidence: async () => { throw new Error("read"); } }, apt, [pay({ status: "failed" })]), "uncertain_status");
    await blocked(mk({}, apt, [pay({ id: "p-open", status: "pending" })]), "payment_in_progress");
  });
  it("failed/cancelled/expired attempts without refund count as zero", async () => {
    const d = mk({}, apt, [pay({ status: "failed" }), pay({ id: "p2", status: "expired" })]);
    expect(await startAppointmentCheckout(req, d.deps)).toMatchObject({ started: true, amountCents: 7200 });
  });
  it("double click starts one provider call; bad provider response releases claim", async () => {
    const d = mk();
    const [a, b] = await Promise.all([startAppointmentCheckout(req, d.deps), startAppointmentCheckout(req, d.deps)]);
    expect([a.started, b.started].sort()).toEqual([false, true]);
    expect(d.startProvider).toHaveBeenCalledTimes(1);
    const bad = mk({ startProvider: vi.fn().mockResolvedValue({ ok: false }) });
    expect(await startAppointmentCheckout(req, bad.deps)).toEqual({ started: false, block: "provider_error" });
    expect(await bad.deps.claim("appt-checkout-apt-1-0")).toBe(true);
  });
  it("other salon, wrong role, no login, cancelled/no-show: blocked", async () => {
    await blocked(mk({ tenantForUser: async () => ({ tenantId: "other", isDemo: true }) }), "not_found");
    await blocked(mk({ rolesForUser: async () => ["medewerker"] }), "forbidden");
    for (const status of ["geannuleerd", "no_show"]) await blocked(mk({}, { ...apt, status }), "cancelled");
    expect(await startAppointmentCheckout({ ...req, jwt: null }, mk().deps)).toEqual({ started: false, block: "not_authenticated" });
  });
  it("UI shows 'betaald' only for server paid status", () => {
    expect(uiStateFromServer("paid")).toBe("betaald");
    for (const s of ["pending", "open", "authorized"]) expect(uiStateFromServer(s)).toBe("wachten");
    for (const s of ["failed", "expired", "cancelled"]) expect(uiStateFromServer(s)).toBe("mislukt");
  });
});
