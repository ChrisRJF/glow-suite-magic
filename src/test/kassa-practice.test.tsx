import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(() => { throw new Error("no terminal query in practice"); }), functions: { invoke: vi.fn() } } }));
import { supabase } from "@/integrations/supabase/client";
import { KassaServerPay } from "@/components/KassaServerPay";

const lines = [{ type: "product" as const, item_id: "p1", qty: 1 }];
const deps = { createOrder: vi.fn(), startPayment: vi.fn(), pollStatus: vi.fn() };

describe("Kassa oefenmodus", () => {
  it("server confirms Demo betaald, no terminal/provider, one order on double click, resets after ~4s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let release!: () => void; const gate = new Promise<void>((r) => (release = r));
    const pc = vi.fn(async () => { await gate; return { ok: true as const, order_id: "o1", total_cents: 3000, status: "practice_paid" }; });
    const onNewSale = vi.fn();
    render(<KassaServerPay userId="u" demo={false} practice customerId={null} lines={lines} onPaid={() => {}} onNewSale={onNewSale} onLockChange={() => {}} deps={deps as any} practiceCheckout={pc} />);
    expect(screen.getByText(/Oefenmodus/)).toBeTruthy();
    expect(screen.queryByLabelText("Pinapparaat")).toBeNull();
    const btn = screen.getByRole("button", { name: /Oefenbetaling afronden/ });
    fireEvent.click(btn); fireEvent.click(btn); fireEvent.click(btn);
    release();
    await screen.findByText("€ 30,00 geoefend", { exact: false }).catch(() => screen.findByText(/geoefend/));
    expect(screen.getAllByText("Demo betaald").length).toBeGreaterThan(0);
    expect(pc).toHaveBeenCalledTimes(1);
    expect(deps.createOrder).not.toHaveBeenCalled(); expect(deps.startPayment).not.toHaveBeenCalled();
    expect((supabase.functions.invoke as any)).not.toHaveBeenCalled();
    expect(onNewSale).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(4100); });
    expect(onNewSale).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it("refusal or network error: no success, retry reuses the same request id", async () => {
    const pc = vi.fn().mockRejectedValueOnce(new Error("net")).mockResolvedValueOnce({ ok: false, reason: "practice_disabled" });
    const onNewSale = vi.fn();
    render(<KassaServerPay userId="u2" demo={false} practice customerId={null} lines={lines} onPaid={() => {}} onNewSale={onNewSale} onLockChange={() => {}} deps={deps as any} practiceCheckout={pc} />);
    fireEvent.click(screen.getByRole("button", { name: /Oefenbetaling afronden/ }));
    await screen.findByText(/Geen verbinding/);
    fireEvent.click(screen.getByRole("button", { name: /Opnieuw proberen/ }));
    await screen.findByText(/niet actief/);
    expect(pc.mock.calls[0][0]).toBe(pc.mock.calls[1][0]);
    expect(screen.queryByText("Demo betaald")).toBeNull(); expect(onNewSale).not.toHaveBeenCalled();
  });
});
