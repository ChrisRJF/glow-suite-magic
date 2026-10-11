import { describe, it, expect } from "vitest";
import { applyEvidence, syncAppointment, derivePaymentStatus, type LedgerDeps, type Evidence } from "../../supabase/functions/_shared/inactive/providerLedger";

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", A = "a1111111-1111-4111-8111-111111111111";
// Fictional in-memory ledger that mirrors record_provider_payment's rules.
function mk(amounts: Record<string, number>) {
  const rows: Evidence[] = []; const appt = { amount_paid: 0, payment_status: "none" };
  const d: LedgerDeps = {
    record: async (e) => {
      if (e.tenantId !== T) return "tenant_mismatch";
      if (e.currency !== "EUR") return "currency_mismatch";
      if (e.kind === "payment" && amounts[e.paymentId] !== e.amountCents) return "amount_mismatch";
      const dup = rows.find((r) => r.provider === e.provider && r.transactionId === e.transactionId && r.kind === e.kind);
      if (dup) return dup.paymentId === e.paymentId ? "duplicate" : "conflict";
      rows.push(e); return "recorded";
    },
    totals: async () => ({ paidCents: rows.filter((r) => r.kind === "payment").reduce((s, r) => s + r.amountCents, 0), refundedCents: rows.filter((r) => r.kind === "refund").reduce((s, r) => s + r.amountCents, 0) }),
    priceCents: async () => 7200,
    updateAppointment: async (_t, _a, p) => { Object.assign(appt, p); },
  };
  return { d, appt, rows };
}
const ev = (o: Partial<Evidence>): Evidence => ({ tenantId: T, paymentId: "dep", provider: "viva", transactionId: "tx-dep", kind: "payment", amountCents: 2000, currency: "EUR", source: "poll", ...o });

describe("providerbevestiging naar grootboek", () => {
  it("aanbetaling, mislukte poging, daarna restbedrag", async () => {
    const m = mk({ dep: 2000, fail: 5200, rest: 5200 });
    expect(await applyEvidence(ev({}), A, m.d)).toBe("recorded");
    expect(m.appt).toEqual({ amount_paid: 20, payment_status: "aanbetaald" });
    await syncAppointment(T, A, m.d); // failed attempt: sync only, no 'unpaid'
    expect(m.appt).toEqual({ amount_paid: 20, payment_status: "aanbetaald" });
    expect(await applyEvidence(ev({ paymentId: "rest", transactionId: "tx-rest", amountCents: 5200, source: "webhook" }), A, m.d)).toBe("recorded");
    expect(m.appt).toEqual({ amount_paid: 72, payment_status: "betaald" });
  });
  it("poll en webhook voor dezelfde transactie tellen één keer", async () => {
    const m = mk({ dep: 2000 });
    await applyEvidence(ev({}), A, m.d);
    expect(await applyEvidence(ev({ source: "webhook" }), A, m.d)).toBe("duplicate");
    expect(m.rows).toHaveLength(1); expect(m.appt.amount_paid).toBe(20);
  });
  it("Mollie: verkeerd bedrag of zonder transactie-ID wordt niet geteld", async () => {
    const m = mk({ dep: 2000 });
    expect(await applyEvidence(ev({ provider: "mollie", transactionId: "tr_1", amountCents: 1999 }), A, m.d)).toBe("amount_mismatch");
    expect(await applyEvidence(ev({ transactionId: null }), A, m.d)).toBe("invalid");
    expect(m.rows).toHaveLength(0);
  });
  it("refund verlaagt bewezen bedrag en blokkeert status betaald", async () => {
    const m = mk({ dep: 2000 });
    await applyEvidence(ev({}), A, m.d);
    await applyEvidence(ev({ kind: "refund", transactionId: "re_1", amountCents: 500 }), A, m.d);
    expect(m.appt).toEqual({ amount_paid: 15, payment_status: "gedeeltelijk_terugbetaald" });
  });
  it("databasefout in grootboek: webhook krijgt 'error', afspraak ongewijzigd", async () => {
    const m = mk({ dep: 2000 }); m.d.record = async () => { throw new Error("db"); };
    expect(await applyEvidence(ev({}), A, m.d)).toBe("error");
    expect(m.appt.payment_status).toBe("none");
  });
  it("statusafleiding", () => {
    expect(derivePaymentStatus(7200, 0, 0)).toBe("unpaid");
    expect(derivePaymentStatus(7200, 7200, 7200)).toBe("terugbetaald");
  });
});
