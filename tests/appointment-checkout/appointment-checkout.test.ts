import { describe, it, expect, vi } from "vitest";
import { handleCheckout, type Deps, type StoredPayment, type LedgerRow } from "../../supabase/functions/_shared/inactive/appointmentCheckoutCore";
import { checkoutVisible } from "../../src/lib/appointmentCheckoutClient";

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AID = "11111111-1111-4111-8111-111111111111";
const apt = { id: AID, user_id: T, is_demo: true, status: "gepland", customer_id: "c1", price: 72, deposit_amount: 20, amount_paid: 0, booking_group_id: null as string | null };
const pay = (o: Partial<StoredPayment>): StoredPayment => ({ id: "p1", appointment_id: AID, user_id: T, amount: 20, status: "paid", is_demo: true, refunded_amount: 0, refunded_at: null, ...o });
const led = (o: Partial<LedgerRow> = {}): LedgerRow => ({ payment_id: "p1", tenant_id: T, appointment_id: AID, kind: "payment", amount_cents: 2000, currency: "EUR", ...o });

function mk(o: { tenant?: string; payments?: StoredPayment[]; ledger?: LedgerRow[]; flag?: boolean; role?: string; a?: any; start?: any } = {}) {
  const claimed = new Set<string>();
  const startProvider = vi.fn(o.start ?? (async () => ({ ok: true, paymentId: "new-pay", checkoutUrl: null })));
  const a = o.a ?? apt;
  const deps: Deps = {
    verifyUser: async (j) => (j === "jwt-ok" ? "u1" : null),
    tenantForUser: async () => ({ tenantId: o.tenant ?? T, isDemo: true, role: o.role ?? "receptie" }),
    flagEnabled: async () => o.flag ?? true,
    loadAppointment: async (tid, id) => (tid === a.user_id && id === a.id ? a : null),
    loadPayments: async () => o.payments ?? [],
    loadLedger: async () => o.ledger ?? [],
    providerReady: async () => true,
    claim: async (k) => (claimed.has(k) ? false : (claimed.add(k), true)),
    attach: async () => {},
    release: async (k) => { claimed.delete(k); },
    startProvider,
  };
  return { deps, startProvider };
}
const start = { jwt: "jwt-ok", action: "start", appointmentId: AID, method: "terminal", terminalId: "22222222-2222-4222-8222-222222222222" };

describe("afrekenen vanuit afspraak", () => {
  it("volledige betaling: start voor de volledige vastgelegde prijs", async () => {
    const m = mk();
    const r = await handleCheckout(start, m.deps);
    expect(r).toMatchObject({ ok: true, quote: { priceCents: 7200, paidCents: 0, dueCents: 7200 }, started: { amountCents: 7200 } });
    expect(m.startProvider.mock.calls[0][0].amountCents).toBe(7200);
  });

  it("aanbetaling bevestigd in grootboek, daarna alleen restbedrag", async () => {
    const m = mk({ payments: [pay({})], ledger: [led()], a: { ...apt, amount_paid: 20 } });
    const r = await handleCheckout(start, m.deps);
    expect(r).toMatchObject({ ok: true, quote: { paidCents: 2000, dueCents: 5200 } });
  });

  it("na restbetaling: volledig betaald, niets meer te starten", async () => {
    const m = mk({ payments: [pay({}), pay({ id: "p2", amount: 52 })], ledger: [led(), led({ payment_id: "p2", amount_cents: 5200 })] });
    expect(await handleCheckout(start, m.deps)).toMatchObject({ ok: false, block: "already_paid" });
    expect(m.startProvider).not.toHaveBeenCalled();
  });

  it("mislukte pinbetaling wist de aanbetaling niet", async () => {
    const m = mk({ payments: [pay({}), pay({ id: "p2", amount: 52, status: "failed" })], ledger: [led()] });
    expect(await handleCheckout({ ...start, action: "quote" }, m.deps)).toMatchObject({ ok: true, quote: { paidCents: 2000, dueCents: 5200 } });
  });

  it("dubbelklik / gelijktijdig: tweede verzoek start geen tweede betaling", async () => {
    const m = mk();
    const [a, b] = await Promise.all([handleCheckout(start, m.deps), handleCheckout(start, m.deps)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(m.startProvider).toHaveBeenCalledTimes(1);
  });

  it("onduidelijke provideruitkomst houdt de claim vast, definitieve weigering geeft hem vrij", async () => {
    const unclear = mk({ start: async () => ({ ok: false, definitive: false }) });
    await handleCheckout(start, unclear.deps);
    expect(await handleCheckout(start, unclear.deps)).toMatchObject({ block: "duplicate" });
    const refused = mk({ start: async () => ({ ok: false, definitive: true }) });
    await handleCheckout(start, refused.deps);
    expect(await handleCheckout(start, refused.deps)).toMatchObject({ block: "provider_error" });
  });

  it("betaallink die nog openstaat blokkeert", async () => {
    const m = mk({ payments: [pay({ id: "p3", amount: 72, status: "open", checkout_url: "https://demo.vivapayments.com/x" })] });
    expect(await handleCheckout(start, m.deps)).toMatchObject({ ok: false, block: "link_open" });
  });

  it("refund of onbekende status blokkeert", async () => {
    expect(await handleCheckout(start, mk({ payments: [pay({})], ledger: [led(), led({ kind: "refund" })] }).deps)).toMatchObject({ block: "refund_present" });
    expect(await handleCheckout(start, mk({ payments: [pay({ refunded_amount: 5 })], ledger: [led()] }).deps)).toMatchObject({ block: "refund_present" });
    expect(await handleCheckout(start, mk({ payments: [pay({ status: "weird" })] }).deps)).toMatchObject({ block: "uncertain_status" });
  });

  it("betaald zonder providerbewijs (Kassa) blokkeert", async () => {
    expect(await handleCheckout(start, mk({ payments: [pay({})] }).deps)).toMatchObject({ block: "unverified_payment" });
    expect(await handleCheckout(start, mk({ a: { ...apt, amount_paid: 20 } }).deps)).toMatchObject({ block: "unverified_payment" });
  });

  it("poging vanuit een andere salon vindt de afspraak niet", async () => {
    const m = mk({ tenant: OTHER });
    expect(await handleCheckout(start, m.deps)).toMatchObject({ ok: false, block: "not_found" });
    expect(m.startProvider).not.toHaveBeenCalled();
  });

  it("rechten, flag, geannuleerd en uitgelogd", async () => {
    expect(await handleCheckout(start, mk({ role: "medewerker" }).deps)).toMatchObject({ block: "forbidden" });
    expect(await handleCheckout(start, mk({ flag: false }).deps)).toMatchObject({ block: "disabled" });
    expect(await handleCheckout(start, mk({ a: { ...apt, status: "geannuleerd" } }).deps)).toMatchObject({ block: "cancelled" });
    expect(await handleCheckout({ ...start, jwt: "bad" }, mk().deps)).toMatchObject({ block: "not_authenticated" });
    expect(await handleCheckout(start, mk({ a: { ...apt, price: null } }).deps)).toMatchObject({ block: "no_price" });
  });

  it("knop alleen zichtbaar bij expliciet true en bevoegde rol", () => {
    expect(checkoutVisible({ data: { appointment_checkout_enabled: true }, error: null }, "receptie")).toBe(true);
    expect(checkoutVisible({ data: { appointment_checkout_enabled: true }, error: null }, "medewerker")).toBe(false);
    expect(checkoutVisible({ data: null, error: null }, "eigenaar")).toBe(false);
    expect(checkoutVisible({ data: null, error: { message: "column does not exist" } }, "eigenaar")).toBe(false);
  });
});
