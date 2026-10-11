import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const BC = "1c6c885e-c944-4717-b2ef-9cfdb9fa15ae";
const OTHER = "cbd7d158-0133-4f2f-a504-4b82f73f2e20";

// Guard: the banner must not run any extra query of its own.
const rpc = vi.fn((..._args: unknown[]) => Promise.resolve({ data: null, error: { message: "nope" } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useSubscription", () => ({ startMollieCheckout: vi.fn() }));

const state = vi.fn();
vi.mock("@/contexts/SubscriptionStateContext", () => ({ useSubscriptionState: () => state() }));

import { TrialBanner } from "@/components/TrialBanner";

const subFor = (user_id: string, extra: Record<string, unknown> = {}) => ({
  id: "sub-1",
  user_id,
  plan_slug: "starter",
  status: "trialing",
  trial_started_at: "2026-10-01T00:00:00Z",
  trial_ends_at: "2026-12-31T23:00:00Z",
  current_period_start: null,
  current_period_end: null,
  mollie_subscription_id: null,
  mollie_customer_id: null,
  mollie_mandate_id: null,
  cancel_at_period_end: false,
  canceled_at: null,
  past_due_since: null,
  payment_failure_email_sent_at: null,
  retry_attempted_at: null,
  ...extra,
}) as any;

const show = (sub: any, daysLeft = 81) => {
  state.mockReturnValue({ sub, daysLeft, isReadOnly: false });
  return render(<MemoryRouter><TrialBanner /></MemoryRouter>);
};

const freeze = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-11T18:00:00Z"));
};

describe("TrialBanner verlengingsmelding", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("Beautycare: verlenging staat er meteen, zonder eigen supabase-call", () => {
    freeze();
    show(subFor(BC));
    expect(screen.getByText("Je gratis proefperiode is verlengd tot 1 januari 2027.")).toBeTruthy();
    expect(screen.queryByText(/Nog 81 dagen/)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("andere salon met afgesproken vrije periode: oude melding blijft exact gelijk", () => {
    freeze();
    show(subFor(OTHER, { free_period_starts_at: "2026-11-01T00:00:00Z" }));
    expect(screen.getByText("Je account staat klaar voor 1 november. Je gratis gebruiksmaand begint dan.")).toBeTruthy();
    expect(screen.queryByText(/verlengd/)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("andere salon zonder vrije periode: gewoon het reguliere proefperiodedebord", () => {
    freeze();
    show(subFor(OTHER), 3);
    expect(screen.getByText(/Nog 3 dagen gratis over/)).toBeTruthy();
    expect(screen.queryByText(/verlengd/)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
