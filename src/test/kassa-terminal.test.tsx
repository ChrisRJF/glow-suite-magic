import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { beginOrResume, loadPending, settlePending, type KassaCart } from "@/lib/kassaPending";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const cart: KassaCart = { a: { name: "Knippen", price: 35, qty: 1, type: "service", itemId: "a" } };
let n = 0;
const key = () => `key-${++n}-xxxxxxxx`;

describe("Kassa open terminal payment", () => {
  it("pending: reopen/reload reuses the same key", () => {
    const s = mem();
    const a = beginOrResume(s, "u1", { cart, customerId: "", demo: true }, key);
    const b = beginOrResume(s, "u1", { cart, customerId: "", demo: true }, key);
    expect(a.ok && b.ok && b.resumed).toBe(true);
    if (a.ok && b.ok) expect(b.pending.key).toBe(a.pending.key);
    expect(loadPending(s, "u1")?.cart).toEqual(cart); // survives reload
  });
  it("pending blocks a different cart (no second payment)", () => {
    const s = mem();
    beginOrResume(s, "u1", { cart, customerId: "", demo: true }, key);
    const other = beginOrResume(s, "u1", { cart: { ...cart, a: { ...cart.a, qty: 2 } }, customerId: "", demo: true }, key);
    expect(other).toMatchObject({ ok: false, reason: "other_pending" });
  });
  it("demo and live never share a key", () => {
    const s = mem();
    beginOrResume(s, "u1", { cart, customerId: "", demo: true }, key);
    expect(beginOrResume(s, "u1", { cart, customerId: "", demo: false }, key)).toMatchObject({ ok: false, reason: "other_pending" });
  });
  it("paid releases; failed releases and the next attempt gets a new key", () => {
    const s = mem();
    const a = beginOrResume(s, "u1", { cart, customerId: "", demo: true }, key);
    if (!a.ok) throw new Error();
    expect(settlePending(s, "u1", a.pending.key, "pending")).toBe(false);
    expect(settlePending(s, "u1", a.pending.key, "failed")).toBe(true);
    const b = beginOrResume(s, "u1", { cart, customerId: "", demo: true }, key);
    if (!b.ok) throw new Error();
    expect(b.pending.key).not.toBe(a.pending.key);
    expect(settlePending(s, "u1", b.pending.key, "paid")).toBe(true);
    expect(loadPending(s, "u1")).toBeNull();
  });
  it("no storage = blocked; empty cart = blocked", () => {
    expect(beginOrResume(null, "u1", { cart, customerId: "", demo: true }, key)).toMatchObject({ ok: false, reason: "storage" });
    expect(beginOrResume(mem(), "u1", { cart: {}, customerId: "", demo: true }, key)).toMatchObject({ ok: false, reason: "empty" });
  });
});

// Dialog behaviour with mocked server calls.
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [{ id: "t1", terminal_id: "T-1", terminal_name: "Balie", status: "active", location_name: null, is_default: true }] }) }) }) }),
  },
}));
vi.mock("@/hooks/useDemoMode", () => ({ useDemoMode: () => ({ demoMode: true }) }));
vi.mock("@/components/VivaPosCredentialsCard", () => ({ useVivaPosReady: () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
import { TerminalPaymentDialog } from "@/components/TerminalPaymentDialog";

describe("TerminalPaymentDialog with caller key", () => {
  beforeEach(() => invoke.mockReset());

  it("double click sends one start, with the caller key", async () => {
    invoke.mockImplementation((fn: string) => fn === "create-viva-terminal-payment"
      ? new Promise((r) => setTimeout(() => r({ data: { payment_id: "p1" } }), 20))
      : Promise.resolve({ data: { status: "pending" } }));
    render(<TerminalPaymentDialog open onOpenChange={() => {}} amountCents={3500} idempotencyKey="kassa-key-123" />);
    const btn = await screen.findByRole("button", { name: "Start betaling" });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn); fireEvent.click(btn);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][1].body.idempotency_key).toBe("kassa-key-123");
  });

  it("reopen uses the same key again (server returns existing payment)", async () => {
    invoke.mockResolvedValue({ data: { payment_id: "p1", idempotent: true } });
    const { rerender } = render(<TerminalPaymentDialog open onOpenChange={() => {}} amountCents={3500} idempotencyKey="kassa-key-123" />);
    rerender(<TerminalPaymentDialog open={false} onOpenChange={() => {}} amountCents={3500} idempotencyKey="kassa-key-123" />);
    rerender(<TerminalPaymentDialog open onOpenChange={() => {}} amountCents={3500} idempotencyKey="kassa-key-123" />);
    const btn = await screen.findByRole("button", { name: "Start betaling" });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls[0][1].body.idempotency_key).toBe("kassa-key-123");
  });

  it.each([["paid"], ["failed"]])("reports provider-final %s once", async (status) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    invoke.mockImplementation((fn: string) => Promise.resolve(fn === "create-viva-terminal-payment" ? { data: { payment_id: "p1" } } : { data: { status } }));
    const onFinal = vi.fn(); const onPaid = vi.fn();
    render(<TerminalPaymentDialog open onOpenChange={() => {}} amountCents={3500} idempotencyKey="kassa-key-123" onFinal={onFinal} onPaid={onPaid} />);
    const btn = await screen.findByRole("button", { name: "Start betaling" });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    await waitFor(() => expect(onFinal).toHaveBeenCalledWith(status));
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onPaid).toHaveBeenCalledTimes(status === "paid" ? 1 : 0);
    vi.useRealTimers();
  });

  it("pending status never reports final", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    invoke.mockImplementation((fn: string) => Promise.resolve(fn === "create-viva-terminal-payment" ? { data: { payment_id: "p1" } } : { data: { status: "pending" } }));
    const onFinal = vi.fn();
    render(<TerminalPaymentDialog open onOpenChange={() => {}} amountCents={3500} idempotencyKey="kassa-key-123" onFinal={onFinal} />);
    const btn = await screen.findByRole("button", { name: "Start betaling" });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await act(async () => { await vi.advanceTimersByTimeAsync(6500); });
    expect(onFinal).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
