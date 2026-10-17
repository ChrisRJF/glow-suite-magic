import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const BC = "1c6c885e-c944-4717-b2ef-9cfdb9fa15ae";
const OTHER = "cbd7d158-0133-4f2f-a504-4b82f73f2e20";

// Guard: the banner must not run any extra query of its own.
const rpc = vi.fn((..._args: unknown[]) => Promise.resolve({ data: null, error: { message: "nope" } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useSubscription", () => ({ startMollieCheckout: vi.fn() }));

const state = vi.fn();
vi.mock("@/contexts/SubscriptionStateContext", () => ({ useSubscriptionState: () => state() }));
const auth = vi.fn(() => ({ user: null as { id: string } | null, loading: false }));
const role = vi.fn(() => ({ roles: ["eigenaar"], loading: false }));
const settings = vi.fn(() => ({ data: [] as Record<string, unknown>[], loading: false, error: null as unknown }));
const merchant = vi.fn(async () => ({ data: null as Record<string, unknown> | null, error: null as unknown }));
const eq = vi.fn();
const from = vi.fn(() => ({ select: () => ({ eq }) }));
eq.mockImplementation(() => ({ eq, maybeSingle: merchant }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth() }));
vi.mock("@/hooks/useUserRole", () => ({ useUserRole: () => role() }));
vi.mock("@/hooks/useSupabaseData", () => ({ useSettings: () => settings() }));

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

describe("TrialBanner GlowPay navigation eligibility", () => {
  const prepare = () => {
    auth.mockReturnValue({ user: { id: OTHER }, loading: false });
    role.mockReturnValue({ roles: ["eigenaar"], loading: false });
    settings.mockReturnValue({ data: [{ user_id: OTHER, demo_mode: false }], loading: false, error: null });
    merchant.mockResolvedValue({ data: null, error: null });
  };
  afterEach(() => { auth.mockReturnValue({ user: null, loading: false }); vi.clearAllMocks(); });

  it.each(["eigenaar", "admin"])("allows %s with a confirmed non-demo account and no merchant", async (allowedRole) => {
    prepare();
    role.mockReturnValue({ roles: [allowedRole], loading: false });
    show(subFor(OTHER, { free_period_starts_at: "2026-11-01T00:00:00Z" }));
    expect(await screen.findByRole("button", { name: "GlowPay activeren" })).toBeTruthy();
    expect(eq).toHaveBeenCalledWith("user_id", OTHER);
    expect(eq).toHaveBeenCalledWith("is_demo", false);
  });

  it.each(["medewerker", "manager", "financieel", "receptie"])("hides for %s", () => {
    prepare(); role.mockReturnValue({ roles: [argumentsRolePlaceholder], loading: false });
  });

  it("hides demo accounts without loading a merchant", () => {
    prepare(); settings.mockReturnValue({ data: [{ user_id: OTHER, demo_mode: true }], loading: false, error: null });
    show(subFor(OTHER));
    expect(screen.queryByRole("button", { name: "GlowPay activeren" })).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("hides an active merchant", async () => {
    prepare(); merchant.mockResolvedValue({ data: { viva_account_id: "a", viva_merchant_id: "m", onboarding_status: "active", kyc_status: "verified", online_payments_enabled: true, viva_source_code: "s", is_demo: false }, error: null });
    show(subFor(OTHER));
    await waitFor(() => expect(merchant).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "GlowPay activeren" })).toBeNull();
  });

  it("hides unreadable merchant status", async () => {
    prepare(); merchant.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    show(subFor(OTHER));
    await waitFor(() => expect(merchant).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "GlowPay activeren" })).toBeNull();
  });

  it("hides missing or unreadable settings and a different signed-in account", () => {
    prepare(); settings.mockReturnValue({ data: [], loading: false, error: null });
    const view = show(subFor(OTHER));
    expect(screen.queryByRole("button", { name: "GlowPay activeren" })).toBeNull();
    view.unmount(); prepare(); auth.mockReturnValue({ user: { id: "different-test-user" }, loading: false });
    show(subFor(OTHER));
    expect(screen.queryByRole("button", { name: "GlowPay activeren" })).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});
