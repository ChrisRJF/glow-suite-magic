import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const deferreds: { resolve: (v: any) => void }[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(() => new Promise((resolve) => deferreds.push({ resolve }))),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, loading: false }),
}));
vi.mock("@/hooks/usePlatformAccess", () => ({
  usePlatformAccess: () => ({ owner: true, aal2: true, loading: false }),
}));
vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children, actions }: any) => (
    <div>
      <div data-testid="actions">{actions}</div>
      {children}
    </div>
  ),
}));

import PlatformPage from "@/pages/PlatformPage";

const usage = (total: number) => ({ period: "p", total, online: 0, cancelled: 0, no_show: 0, per_salon: {}, trend: [] });
const overview = { salons_total: 0, salons_real: 0, salons_demo: 0, subs_active: 0, subs_trialing: 0, subs_expired: 0, subs_pending: 0, subs_none: 0, trials_ending_7d: 0, cancellations: 0, past_due: 0, free_period: 0, projected_mrr_cents: 0, salons: [] };

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

describe("PlatformPage period switch", () => {
  beforeEach(() => { deferreds.length = 0; });

  it("an older response never overwrites the latest selected period", async () => {
    render(<PlatformPage />);
    // overview RPC resolves
    await act(async () => { deferreds[0].resolve({ data: overview, error: null }); });
    // first period fetch (usage + finance) pending
    expect(deferreds.length).toBe(3);

    // switch period -> cleanup marks first fetch stale, new fetch starts
    const trigger = screen.getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    fireEvent.click(options[1]);
    await flush();
    expect(deferreds.length).toBe(5);

    // resolve NEW period first
    await act(async () => {
      deferreds[3].resolve({ data: usage(42), error: null });
      deferreds[4].resolve({ data: [], error: null });
    });
    expect(screen.getByText("42")).toBeTruthy();

    // stale OLD period resolves later: must not overwrite
    await act(async () => {
      deferreds[1].resolve({ data: usage(7), error: null });
      deferreds[2].resolve({ data: [], error: null });
    });
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.queryByText("7")).toBeNull();
  });

  it("a stale failure cannot override a newer successful result", async () => {
    render(<PlatformPage />);
    await act(async () => { deferreds[0].resolve({ data: overview, error: null }); });

    const trigger = screen.getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(screen.getAllByRole("option")[1]);
    await flush();

    await act(async () => {
      deferreds[3].resolve({ data: usage(5), error: null });
      deferreds[4].resolve({ data: [], error: null });
    });
    await act(async () => {
      deferreds[1].resolve({ data: null, error: { message: "boom" } });
      deferreds[2].resolve({ data: null, error: { message: "boom" } });
    });
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.queryByText(/technische fout|boom/i)).toBeNull();
  });
});
