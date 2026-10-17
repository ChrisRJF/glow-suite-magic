import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { AutoRevenueMetrics } from "@/components/AutoRevenueMetrics";

const state = vi.hoisted(() => ({
  user: { id: "test-salon" },
  offers: [] as { status: string; created_at: string }[],
  payments: [] as Record<string, unknown>[],
  offerError: null as null | { message: string },
  filters: [] as [string, string, unknown][],
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/hooks/useDemoMode", () => ({ useDemoMode: () => ({ demoMode: true }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    let rows: Record<string, unknown>[] = table === "auto_revenue_offers" ? [...state.offers] : table === "payments" ? [...state.payments] : [];
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        state.filters.push([table, column, value]);
        if (column === "status") rows = rows.filter((row) => row[column] === value);
        return query;
      },
      gte: (column: string, value: string) => {
        state.filters.push([table, column, value]);
        rows = rows.filter((row) => typeof row[column] === "string" && String(row[column]) >= value);
        return query;
      },
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: rows, count: 0, error: table === "auto_revenue_offers" ? state.offerError : null }).then(resolve),
    };
    return query;
  },
} }));

function value(label: string) { return screen.getByText(label).parentElement?.nextElementSibling?.textContent; }
const today = new Date();
today.setHours(12, 0, 0, 0);
const created_at = today.toISOString();
const old = new Date(today);
old.setDate(old.getDate() - 40);

beforeEach(() => { state.offers = []; state.payments = []; state.offerError = null; state.filters = []; });
afterEach(cleanup);

describe("AutoRevenueMetrics creation-cohort conversion", () => {
  it("uses paid offers over all created offers, including expired/failed, not paid-time payments", async () => {
    state.offers = ["paid", "sent", "expired", "failed"].map((status) => ({ status, created_at }));
    state.offers.push({ status: "paid", created_at: old.toISOString() });
    state.payments = [{ amount: 50, status: "paid", paid_at: created_at, metadata: { source: "auto_revenue_deposit", offer_id: "old-offer" } }];
    render(<AutoRevenueMetrics />);
    await waitFor(() => expect(value("Aanbodconversie")).toBe("25%"));
    expect(value("Aanbiedingen")).toBe("4");
    expect(value("Betaald")).toBe("1");
    expect(state.filters).toContainEqual(["auto_revenue_offers", "user_id", "test-salon"]);
    expect(state.filters).toContainEqual(["auto_revenue_offers", "is_demo", true]);
  });

  it("cannot establish conversion for an empty cohort even when payments arrived", async () => {
    state.payments = [{ amount: 50, status: "paid", paid_at: created_at, metadata: { source: "auto_revenue_full" } }];
    render(<AutoRevenueMetrics />);
    await waitFor(() => expect(value("Aanbodconversie")).toBe("Niet beschikbaar"));
  });

  it("does not present an unreadable cohort as zero conversion", async () => {
    state.offerError = { message: "unavailable" };
    state.offers = [{ status: "sent", created_at }];
    render(<AutoRevenueMetrics />);
    await waitFor(() => expect(value("Aanbodconversie")).toBe("Niet beschikbaar"));
  });

  it.each([
    [["sent", "pending_payment"], "0%"],
    [["paid", "paid"], "100%"],
    [["paid", "sent", "cancelled"], "33%"],
  ])("handles cohort %j as %s", async (statuses, expected) => {
    state.offers = (statuses as string[]).map((status) => ({ status, created_at }));
    render(<AutoRevenueMetrics />);
    await waitFor(() => expect(value("Aanbodconversie")).toBe(expected));
  });

  it("includes an offer exactly at the period start and excludes one immediately before", async () => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    state.offers = [
      { status: "paid", created_at: start.toISOString() },
      { status: "paid", created_at: new Date(start.getTime() - 1).toISOString() },
      { status: "sent", created_at },
    ];
    render(<AutoRevenueMetrics />);
    await waitFor(() => expect(value("Aanbodconversie")).toBe("50%"));
    expect(value("Aanbiedingen")).toBe("2");
  });
});