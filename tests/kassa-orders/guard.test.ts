import { describe, it, expect, vi } from "vitest";
import { isKassaPayment, processKassaEvent } from "../../supabase/functions/_shared/kassaGuard";

const P = { id: "pay-1", user_id: "tenant-a" };
function admin(results: Record<string, unknown>) {
  const rpc = vi.fn(async (fn: string) => ({ data: results[fn] ?? null, error: null }));
  return { rpc } as any;
}

describe("kassa guard", () => {
  it("only payments with kassa_order_id are Kassa payments", () => {
    expect(isKassaPayment({ kassa_order_id: "o" })).toBe(true);
    expect(isKassaPayment({ checkout: "appointment_checkout" })).toBe(false);
    expect(isKassaPayment(null)).toBe(false);
  });
  it("paid with Viva evidence records ledger then settles", async () => {
    const a = admin({ record_provider_payment: "recorded", kassa_settle_order: "settled" });
    expect(await processKassaEvent(a, P, "paid", { transactionId: "tx", amountCents: 6500, source: "webhook" })).toBe("settled");
    expect(a.rpc.mock.calls.map((c: any[]) => c[0])).toEqual(["record_provider_payment", "kassa_settle_order"]);
  });
  it("duplicate confirmation never settles twice", async () => {
    const a = admin({ record_provider_payment: "duplicate", kassa_settle_order: "duplicate" });
    expect(await processKassaEvent(a, P, "paid", { transactionId: "tx", amountCents: 6500, source: "poll" })).toBe("duplicate");
  });
  it("paid without evidence does not record; database refuses settlement", async () => {
    const a = admin({ kassa_settle_order: "no_evidence" });
    expect(await processKassaEvent(a, P, "paid", null)).toBe("no_evidence");
    expect(a.rpc.mock.calls.map((c: any[]) => c[0])).toEqual(["kassa_settle_order"]);
  });
  it("failed closes the attempt only", async () => {
    const a = admin({ kassa_attempt_failed: "failed" });
    expect(await processKassaEvent(a, P, "failed", null)).toBe("failed");
  });
  it("non-final status does nothing", async () => {
    const a = admin({});
    expect(await processKassaEvent(a, P, null, null)).toBe("noop");
    expect(a.rpc).not.toHaveBeenCalled();
  });
  it("database error never throws", async () => {
    const a = { rpc: vi.fn(async () => { throw new Error("down"); }) } as any;
    expect(await processKassaEvent(a, P, "paid", { transactionId: "tx", amountCents: 6500, source: "poll" })).toBe("error");
  });
});
