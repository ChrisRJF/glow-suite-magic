import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NoShowCenter } from "@/components/NoShowCenter";

const fixtures = vi.hoisted(() => ({ customers: [] as any[], appointments: [] as any[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/useUserRole", () => ({ useUserRole: () => ({ hasAny: () => false }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useCustomers: () => ({ data: fixtures.customers }),
  useAppointments: () => ({ data: fixtures.appointments }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("NoShowCenter high-risk count", () => {
  it("legacy counters alone never count as high risk (fail-safe)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T12:00:00"));
    fixtures.customers = [{ id: "high", no_show_count: 5, cancellation_count: 4 }];
    fixtures.appointments = [
      { customer_id: "high", appointment_date: "2026-10-17T14:00:00", status: "bevestigd" },
    ];
    render(<MemoryRouter><NoShowCenter /></MemoryRouter>);
    expect(screen.getByText("Hoog risico").previousElementSibling?.textContent).toBe("0");
  });

  it("counts only isHigh appointments from verified history, excluding elevated, cancelled and outside the window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T12:00:00"));
    fixtures.customers = [
      { id: "low", verifiedHistory: { completed: 5, noShows: 0, lateCancellations: 0 } },
      { id: "medium", verifiedHistory: { completed: 3, noShows: 0, lateCancellations: 2 } },
      { id: "high", verifiedHistory: { completed: 1, noShows: 2, lateCancellations: 0 } },
    ];
    fixtures.appointments = [
      ...["low", "medium", "high"].map((customer_id) => ({ customer_id, appointment_date: "2026-10-17T14:00:00", status: "bevestigd" })),
      { customer_id: "high", appointment_date: "2026-10-18T14:00:00", status: "bevestigd" },
      { customer_id: "high", appointment_date: "2026-10-17T15:00:00", status: "geannuleerd" },
      { customer_id: "high", appointment_date: "2026-10-17T10:00:00", status: "bevestigd" },
      { customer_id: "high", appointment_date: "2026-10-19T14:00:00", status: "bevestigd" },
    ];
    render(<MemoryRouter><NoShowCenter /></MemoryRouter>);
    expect(screen.getByText("Hoog risico").previousElementSibling?.textContent).toBe("2");
  });
});