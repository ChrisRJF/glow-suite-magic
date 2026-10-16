import { describe, it, expect, vi, beforeEach } from "vitest";

const selectMock = vi.fn();
const updateMock = vi.fn();
const insertMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: selectMock }) }),
      update: (v: unknown) => { updateMock(v); return { eq: () => Promise.resolve({ error: null }) }; },
      insert: (v: unknown) => { insertMock(v); return Promise.resolve({ error: null }); },
    }),
  },
}));

import { readServerOnboardingState, fetchServerOnboardingState, persistOnboardingState } from "@/lib/onboardingPrefs";

describe("onboardingPrefs", () => {
  beforeEach(() => { selectMock.mockReset(); updateMock.mockReset(); insertMock.mockReset(); });

  it("leest geldige server-statussen", () => {
    expect(readServerOnboardingState({ onboarding_v4: { state: "dismissed" } })).toBe("dismissed");
    expect(readServerOnboardingState({ onboarding_v4: { state: "done" } })).toBe("done");
    expect(readServerOnboardingState({ onboarding_v4: { state: "skipped" } })).toBe("skipped");
  });

  it("negeert ontbrekende of ongeldige waarden", () => {
    expect(readServerOnboardingState(null)).toBeNull();
    expect(readServerOnboardingState({})).toBeNull();
    expect(readServerOnboardingState({ onboarding_v4: { state: "later" } })).toBeNull();
    expect(readServerOnboardingState({ glowpay_activation: { completed: true } })).toBeNull();
  });

  it("fetch geeft null bij netwerkfout (fail-safe)", async () => {
    selectMock.mockResolvedValue({ data: null, error: { message: "network" } });
    expect(await fetchServerOnboardingState("u1")).toBeNull();
  });

  it("fetch geeft server-status terug", async () => {
    selectMock.mockResolvedValue({ data: { whitelabel_branding: { onboarding_v4: { state: "dismissed" } } }, error: null });
    expect(await fetchServerOnboardingState("u1")).toBe("dismissed");
  });

  it("persist behoudt bestaande branding-sleutels bij update", async () => {
    selectMock.mockResolvedValue({ data: { whitelabel_branding: { glowpay_activation: { completed: true } } }, error: null });
    await persistOnboardingState("u1", "dismissed");
    expect(updateMock).toHaveBeenCalledTimes(1);
    const arg = updateMock.mock.calls[0][0] as any;
    expect(arg.whitelabel_branding.glowpay_activation.completed).toBe(true);
    expect(arg.whitelabel_branding.onboarding_v4.state).toBe("dismissed");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("persist maakt rij aan als settings ontbreken", async () => {
    selectMock.mockResolvedValue({ data: null, error: null });
    await persistOnboardingState("u1", "done");
    expect(insertMock).toHaveBeenCalledTimes(1);
    const arg = insertMock.mock.calls[0][0] as any;
    expect(arg.user_id).toBe("u1");
    expect(arg.whitelabel_branding.onboarding_v4.state).toBe("done");
  });

  it("persist slikt fouten zonder te gooien", async () => {
    selectMock.mockRejectedValue(new Error("down"));
    await expect(persistOnboardingState("u1", "skipped")).resolves.toBeUndefined();
  });
});
