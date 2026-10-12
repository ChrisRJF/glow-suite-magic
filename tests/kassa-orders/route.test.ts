import { describe, it, expect, vi } from "vitest";
import { startKassaPayment, afterProviderEvent, type KassaDeps } from "../../supabase/functions/_shared/inactive/kassaRoute";

const O = "11111111-0000-0000-0000-000000000001", T = "22222222-0000-0000-0000-000000000002";
const begin = { ok: true as const, resumed: false, idempotency_key: "kassa:o:live:1", payment_id: null, total_cents: 6500, is_demo: false, tenant_id: "tenant-a", customer_id: null };

function deps(over: Partial<KassaDeps> = {}): KassaDeps {
  return {
    actor: async () => "actor-1",
    begin: vi.fn(async () => begin),
    startTerminal: vi.fn(async () => ({ ok: true as const, paymentId: "pay-1" })),
    attach: vi.fn(async () => true),
    ...over,
  };
}

describe("kassa route", () => {
  it("weigert zonder login", async () => {
    expect((await startKassaPayment({ order_id: O, terminal_id: T }, deps({ actor: async () => null }))).status).toBe(401);
  });
  it("browserbedrag, modus en salon worden genegeerd", async () => {
    const d = deps();
    await startKassaPayment({ order_id: O, terminal_id: T, amount_cents: 1, is_demo: true, tenant_id: "evil" }, d);
    expect(d.startTerminal).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 6500, isDemo: false, tenantId: "tenant-a", idempotencyKey: "kassa:o:live:1" }));
  });
  it("hervatten met bestaande betaling start geen tweede", async () => {
    const d = deps({ begin: vi.fn(async () => ({ ...begin, resumed: true, payment_id: "pay-1" })) });
    const r = await startKassaPayment({ order_id: O, terminal_id: T }, d);
    expect(r.body.payment_id).toBe("pay-1");
    expect(d.startTerminal).not.toHaveBeenCalled();
  });
  it("live niet geactiveerd: Nederlandse melding, geen terminal", async () => {
    const d = deps({ begin: vi.fn(async () => ({ ok: false as const, reason: "live_not_allowed" })) });
    const r = await startKassaPayment({ order_id: O, terminal_id: T }, d);
    expect(r.status).toBe(409);
    expect(String(r.body.message)).toContain("demo afrekenen");
    expect(d.startTerminal).not.toHaveBeenCalled();
  });
  it("onduidelijke provideruitkomst: geen succes, zelfde sleutel", async () => {
    const r = await startKassaPayment({ order_id: O, terminal_id: T }, deps({ startTerminal: async () => ({ ok: false, unclear: true, message: "x" }) }));
    expect(r.status).toBe(202);
    expect(r.body.retry_same_key).toBe(true);
  });
  it("na betaald alleen verwerken via settle; mislukt via attempt_failed", async () => {
    const rpc = vi.fn(async (fn: string) => fn === "kassa_settle_order" ? "settled" : "failed");
    expect(await afterProviderEvent("p", "paid", rpc)).toBe("settled");
    expect(await afterProviderEvent("p", "failed", rpc)).toBe("failed");
    expect(await afterProviderEvent("p", null, rpc)).toBe("noop");
  });
});
