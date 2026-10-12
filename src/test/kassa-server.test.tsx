import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { payWithKassa, loadSaved, type KassaServerDeps } from "@/lib/kassaServer";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [{ id: "t1", name: "Pin 1" }] }) }) }) }) } }));
import { KassaServerPay } from "@/components/KassaServerPay";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const lines = [{ type: "product" as const, item_id: "p1", qty: 2 }];
const deps = (o: Partial<KassaServerDeps> = {}): KassaServerDeps => ({
  createOrder: vi.fn(async () => ({ ok: true as const, order_id: "o1", total_cents: 6500 })),
  startPayment: vi.fn(async () => ({ status: 200, body: { payment_id: "pay1" } })),
  pollStatus: vi.fn(async () => "paid"), ...o,
});
const args = (storage: any, demo = true) => ({ storage, userId: "u", customerId: null, lines, demo, terminalId: "t1" });

describe("Kassa server flow", () => {
  it("paid: order, start, status; total from server", async () => {
    const s = mem(); const d = deps(); const states: string[] = [];
    const r = await payWithKassa(args(s), d, (x) => states.push(x.phase));
    expect(r.phase).toBe("paid"); expect(r.totalCents).toBe(6500);
    expect(states).toEqual(["creating", "starting", "open", "paid"]);
    expect(loadSaved(s, "u")).toBeNull();
  });
  it("pending then reload resumes the same payment, never a second one", async () => {
    const s = mem(); const d = deps({ pollStatus: vi.fn(async () => null) });
    expect((await payWithKassa(args(s), d, () => {})).phase).toBe("open");
    const d2 = deps({ pollStatus: vi.fn(async () => "paid") });
    expect((await payWithKassa({ ...args(s), lines: [] }, d2, () => {})).phase).toBe("paid");
    expect(d2.createOrder).not.toHaveBeenCalled(); expect(d2.startPayment).not.toHaveBeenCalled();
  });
  it("failed allows retry on the same order (same request id)", async () => {
    const s = mem(); const d = deps({ pollStatus: vi.fn(async () => "failed") });
    expect((await payWithKassa(args(s), d, () => {})).phase).toBe("failed");
    await payWithKassa(args(s), d, () => {});
    const ids = (d.createOrder as any).mock.calls.map((c: any[]) => c[0]);
    expect(ids[0]).toBe(ids[1]);
  });
  it("server refusal shows a clear message", async () => {
    const r = await payWithKassa(args(mem(), false), deps({ createOrder: vi.fn(async () => ({ ok: false as const, reason: "live_not_allowed" })) }), () => {});
    expect(r.phase).toBe("error"); expect(r.message).toMatch(/Live betalen/);
  });
  it("start error message from server is shown, no payment saved", async () => {
    const s = mem();
    const r = await payWithKassa(args(s), deps({ startPayment: vi.fn(async () => ({ status: 403, body: { error: "no_access", message: "Je hebt geen kassarechten in deze salon." } })) }), () => {});
    expect(r.message).toMatch(/kassarechten/); expect(loadSaved(s, "u")?.paymentId).toBeUndefined();
  });
  it("storage unavailable fails closed", async () => {
    const d = deps(); const r = await payWithKassa(args(null), d, () => {});
    expect(r.phase).toBe("error"); expect(d.createOrder).not.toHaveBeenCalled();
  });
  it("double click starts only one order", async () => {
    let release!: () => void; const gate = new Promise<void>((r) => (release = r));
    const d = deps({ createOrder: vi.fn(async () => { await gate; return { ok: true as const, order_id: "o1", total_cents: 6500 }; }) });
    render(<KassaServerPay userId="u-dbl" demo customerId={null} lines={lines} onPaid={() => {}} onLockChange={() => {}} deps={d} />);
    const btn = await screen.findByRole("button", { name: /Betaal op pinapparaat/ });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn); fireEvent.click(btn); fireEvent.click(btn);
    release();
    await screen.findByText(/Betaald/);
    expect(d.createOrder).toHaveBeenCalledTimes(1);
  });
});
