import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateIsvDemoConfirmation, confirmIsvDemoPayment, isIsvDemoPayment } from "../../supabase/functions/_shared/isvDemoConfirm";

const pay = (o: any = {}) => ({ id: "p1", status: "pending", is_demo: true, payment_type: "isv_demo", viva_merchant_id: "m1",
  metadata: { isv_demo_key: "isv-demo-e2e-1799", channel: "online", viva_order_code: "42" }, ...o });
const tx = (o: any = {}) => ({ statusId: "F", amountCents: 100, currencyCode: "978", orderCode: "42", merchantId: "m1", ...o });
const ev = (o: any = {}) => evaluateIsvDemoConfirmation({ payment: pay(), hasExpectedCommission: true, eventMerchantId: "m1", transactionId: "t", tx: tx(), ...o }, "now");

describe("ISV demo confirmation", () => {
  it("confirmed ISV demo payment is accepted", () => expect(ev().ok).toBe(true));
  it("unverified or deviating transactions stay pending", () => {
    expect(ev({ tx: null })).toEqual({ ok: false, reason: "viva_unverified" });
    expect(ev({ tx: tx({ statusId: "X" }) }).ok).toBe(false);
    expect(ev({ tx: tx({ amountCents: 99 }) }).ok).toBe(false);
    expect(ev({ tx: tx({ currencyCode: "840" }) }).ok).toBe(false);
    expect(ev({ tx: tx({ orderCode: "43" }) }).ok).toBe(false);
    expect(ev({ tx: tx({ merchantId: "m2" }) }).ok).toBe(false);
    expect(ev({ eventMerchantId: "m2" }).ok).toBe(false);
    expect(ev({ hasExpectedCommission: false }).ok).toBe(false);
  });
  it("only rows from the secured ISV demo route qualify", () => {
    expect(isIsvDemoPayment(pay({ is_demo: false }))).toBe(false);
    expect(isIsvDemoPayment(pay({ payment_type: "online" }))).toBe(false);
    expect(isIsvDemoPayment(pay({ metadata: { checkout: "appointment_checkout", environment: "demo" } }))).toBe(false);
  });
  it("no double update: already paid is not re-applied", () => {
    expect(ev({ payment: pay({ status: "paid" }) })).toEqual({ ok: false, reason: "status_paid" });
  });

  it("apply step: conditional pending->paid, no ledger, margin or commission writes", async () => {
    const writes: string[] = [];
    let updateFilters: string[] = [];
    const sb = { from(t: string) {
      const q: any = { _t: t, select: () => q, eq: (k: string, v: any) => { updateFilters.push(`${k}=${v}`); return q; }, limit: async () => ({ data: [{ id: "c" }], error: null }),
        update: (_v: any) => { writes.push(t); updateFilters = []; return q; }, insert: () => { writes.push(t + ":insert"); return q; } };
      q.select = (..._a: any[]) => (writes.includes(t) ? Promise.resolve({ data: [{ id: "p1" }], error: null }) : q);
      return q; }, rpc: () => { writes.push("rpc"); } };
    const f = async (url: string) => new Response(JSON.stringify(url.includes("token") ? { access_token: "x" } : { statusId: "F", amount: 1, currencyCode: "978", orderCode: 42, merchantId: "m1" }));
    const r = await confirmIsvDemoPayment(sb, { VIVA_ISV_CLIENT_ID: "a", VIVA_ISV_CLIENT_SECRET: "b" }, pay(), "t", "m1", f as any);
    expect(r.result).toBe("confirmed");
    expect(writes).toEqual(["payments"]);
    expect(updateFilters).toContain("status=pending");
  });

  it("Viva unreachable leaves status untouched", async () => {
    const writes: string[] = [];
    const sb = { from(t: string) { const q: any = { select: () => q, eq: () => q, limit: async () => ({ data: [{ id: "c" }], error: null }), update: () => { writes.push(t); return q; } }; return q; } };
    const r = await confirmIsvDemoPayment(sb, { VIVA_ISV_CLIENT_ID: "a", VIVA_ISV_CLIENT_SECRET: "b" }, pay(), "t", "m1", (async () => { throw new Error("down"); }) as any);
    expect(r.result).toBe("unavailable");
    expect(writes).toEqual([]);
  });

  it("webhook: ISV demo branch precedes the demo/normal paths; normal flow untouched", () => {
    const src = readFileSync("supabase/functions/viva-webhook/index.ts", "utf8");
    const isv = src.indexOf("isIsvDemoPayment(payment as any)");
    const demo = src.indexOf("if (payment.is_demo) {");
    const normal = src.indexOf("Authoritative status via Viva API");
    expect(isv).toBeGreaterThan(0);
    expect(isv).toBeLessThan(demo);
    expect(demo).toBeLessThan(normal);
    const block = src.slice(isv, demo);
    expect(block).not.toMatch(/recordMargin|record_platform_commission|payment_ledger|applyEvidence/);
    expect(src).toContain('demoNote: string | null = "demo_not_applicable"');
  });
});
