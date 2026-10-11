import { describe, it, expect, vi } from "vitest";
import { startAppointmentCheckout, uiStateFromServer, type Deps, type StoredPayment } from "../../docs/prepared-patches/appointment-checkout/appointmentCheckoutCore";

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const apt = { id: "apt-1", user_id: T, is_demo: true, status: "gepland", service_id: "s1", customer_id: "c1", total_price: 80 };
const pay = (o: Partial<StoredPayment>): StoredPayment => ({ id: "p", appointment_id: "apt-1", user_id: T, amount: 0, status: "paid", payment_type: "deposit", provider: "viva", is_demo: true, ...o });

function mk(over: Partial<Deps> = {}, a: any = apt, payments: StoredPayment[] = []) {
  const claimed = new Set<string>();
  const startProvider = vi.fn().mockResolvedValue({ ok: true, paymentId: "new-pay", checkoutUrl: null });
  const deps: Deps = {
    verifyUser: async (j) => (j === "jwt-ok" ? "u1" : null),
    tenantForUser: async () => ({ tenantId: T, isDemo: true }),
    rolesForUser: async () => ["eigenaar"],
    loadAppointment: async (tid, id) => (tid === a.user_id && id === a.id ? a : null),
    loadServicePrice: async () => 65,
    loadPayments: async () => payments,
    providerReady: async () => true,
    claim: async (k) => (claimed.has(k) ? false : (claimed.add(k), true)),
    release: async (k) => { claimed.delete(k); },
    startProvider,
    ...over,
  };
  return { deps, startProvider };
}
const req = { jwt: "jwt-ok", appointmentId: "apt-1", method: "terminal", terminalId: "term-demo" };

describe("appointment checkout (fictional demo salon, mocks only, no real payments)", () => {
  it("unpaid appointment: server amount = full price, state waiting, never 'paid' at start", async () => {
    const { deps, startProvider } = mk();
    const r = await startAppointmentCheckout({ ...req, tipCents: 0 }, deps);
    expect(r).toMatchObject({ started: true, amountCents: 8000, state: "waiting_provider" });
    expect(startProvider.mock.calls[0][0]).toMatchObject({ amountCents: 8000, appointmentId: "apt-1", tenantId: T });
  });
  it("deposit paid: only the remainder is charged", async () => {
    const { deps, startProvider } = mk({}, apt, [pay({ amount: 20 })]);
    expect(await startAppointmentCheckout(req, deps)).toMatchObject({ started: true, amountCents: 6000 });
    expect(startProvider.mock.calls[0][0].idempotencyKey).toBe("appt-checkout-apt-1-2000");
  });
  it("fully paid appointment: blocked, no provider call", async () => {
    const { deps, startProvider } = mk({}, apt, [pay({ amount: 20 }), pay({ id: "p2", amount: 60, payment_type: "remainder" })]);
    expect(await startAppointmentCheckout(req, deps)).toEqual({ started: false, block: "already_paid" });
    expect(startProvider).not.toHaveBeenCalled();
  });
  it("failed/cancelled earlier attempts do not count as paid", async () => {
    const { deps } = mk({}, apt, [pay({ amount: 80, status: "failed" }), pay({ id: "p2", amount: 80, status: "cancelled" })]);
    expect(await startAppointmentCheckout(req, deps)).toMatchObject({ started: true, amountCents: 8000 });
  });
  it("payment already in progress or double click: no second payment", async () => {
    const busy = mk({}, apt, [pay({ id: "p-open", amount: 80, status: "pending" })]);
    expect(await startAppointmentCheckout(req, busy.deps)).toEqual({ started: false, block: "payment_in_progress", existingPaymentId: "p-open" });
    const { deps, startProvider } = mk();
    const [a, b] = await Promise.all([startAppointmentCheckout(req, deps), startAppointmentCheckout(req, deps)]);
    expect([a.started, b.started].sort()).toEqual([false, true]);
    expect(startProvider).toHaveBeenCalledTimes(1);
  });
  it("bad provider response: not paid, claim released, retry possible", async () => {
    const bad = vi.fn().mockResolvedValueOnce({ ok: false }).mockRejectedValueOnce(new Error("502"));
    const { deps } = mk({ startProvider: bad });
    expect(await startAppointmentCheckout(req, deps)).toEqual({ started: false, block: "provider_error" });
    expect(await startAppointmentCheckout(req, deps)).toEqual({ started: false, block: "provider_error" });
    expect(await deps.claim("appt-checkout-apt-1-0")).toBe(true);
  });
  it("other salon, wrong role, no login: blocked", async () => {
    for (const c of [
      { tenantForUser: async () => ({ tenantId: "other", isDemo: true }) },
      { tenantForUser: async () => ({ tenantId: T, isDemo: false }) },
      { rolesForUser: async () => ["medewerker"] },
    ] as Partial<Deps>[]) {
      const { deps, startProvider } = mk(c);
      expect((await startAppointmentCheckout(req, deps)).started).toBe(false);
      expect(startProvider).not.toHaveBeenCalled();
    }
    const { deps } = mk();
    expect(await startAppointmentCheckout({ ...req, jwt: null }, deps)).toEqual({ started: false, block: "not_authenticated" });
  });
  it("cancelled/no-show, refunds, unreadable payments, provider not ready: blocked", async () => {
    for (const s of ["geannuleerd", "cancelled", "no_show"]) {
      const { deps } = mk({}, { ...apt, status: s });
      expect(await startAppointmentCheckout(req, deps)).toEqual({ started: false, block: "cancelled" });
    }
    expect((await startAppointmentCheckout(req, mk({}, apt, [pay({ amount: 80, status: "refunded" })]).deps))).toEqual({ started: false, block: "refund_present" });
    expect((await startAppointmentCheckout(req, mk({ loadPayments: async () => null }).deps))).toEqual({ started: false, block: "provider_error" });
    expect((await startAppointmentCheckout(req, mk({ providerReady: async () => false }).deps))).toEqual({ started: false, block: "provider_not_ready" });
  });
  it("client cannot set amount; price falls back to same-salon service price", async () => {
    const { deps, startProvider } = mk({}, { ...apt, total_price: null });
    await startAppointmentCheckout({ ...req, amountCents: 1 } as any, deps);
    expect(startProvider.mock.calls[0][0].amountCents).toBe(6500);
  });
  it("UI shows 'betaald' only for provider-confirmed paid", () => {
    expect(uiStateFromServer("paid")).toBe("betaald");
    for (const s of ["pending", "open", "processing", "authorized"]) expect(uiStateFromServer(s)).toBe("wachten");
    for (const s of ["failed", "expired", "cancelled"]) expect(uiStateFromServer(s)).toBe("mislukt");
  });
});
