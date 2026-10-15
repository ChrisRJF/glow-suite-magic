import { describe, it, expect } from "vitest";
import {
  handleOnboardingWebhook, syncForSession, livePaymentAllowed, decideCreate, parseCreate, deriveUpdate,
  type MerchantRow,
} from "../../supabase/functions/_shared/inactive/isvOnboardingSafety";

const ACC_A = "11111111-aaaa-4aaa-8aaa-111111111111";
const ACC_B = "22222222-bbbb-4bbb-8bbb-222222222222";
const MID_A = "aaaaaaaa-0000-4000-8000-00000000000a";

const row = (o: Partial<MerchantRow> = {}): MerchantRow => ({
  id: "row-a", user_id: "salon-a", is_demo: false, viva_account_id: ACC_A, viva_merchant_id: null,
  viva_source_code: null, onboarding_status: "invited", kyc_status: null, onboarding_url: "https://x.example/onb", ...o,
});
const vivaReturns = (body: unknown, ok = true) => async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 });

function deps(over: any = {}) {
  const seen = new Set<string>(); const updates: any[] = [];
  return {
    updates,
    d: {
      env: "live" as const, getIsvToken: async () => "isv-token",
      fetchFn: vivaReturns({ accountId: ACC_A, merchantId: MID_A, verified: false }),
      recordEvent: async (k: string) => (seen.has(k) ? "duplicate" : (seen.add(k), "inserted")) as any,
      findByAccountId: async (id: string) => (id === ACC_A ? row() : null),
      update: async (_id: string, _u: string, upd: any) => (updates.push(upd), true),
      ...over,
    },
  };
}
const evt = (o: any = {}) => JSON.stringify({ EventTypeId: 8194, MessageId: "m1", EventData: { ConnectedAccountId: ACC_A, Verified: true, PersonId: "forged", SourceCode: "9999" }, ...o });

describe("webhook: body is only a hint", () => {
  it("forged Verified=true + MerchantId + SourceCode does not activate when Viva says not verified", async () => {
    const { d, updates } = deps();
    expect((await handleOnboardingWebhook(evt(), d)).result).toBe("updated");
    expect(updates[0].onboarding_status).toBe("kyc_pending");
    expect(updates[0].viva_merchant_id).toBe(MID_A);
    expect(updates[0]).not.toHaveProperty("viva_source_code");
  });
  it("replay of same MessageId is a no-op", async () => {
    const { d, updates } = deps();
    await handleOnboardingWebhook(evt(), d);
    expect((await handleOnboardingWebhook(evt(), d)).result).toBe("duplicate");
    expect(updates).toHaveLength(1);
  });
  it("unknown account is never bound from a webhook", async () => {
    const { d, updates } = deps();
    const r = await handleOnboardingWebhook(evt({ MessageId: "m2", EventData: { ConnectedAccountId: ACC_B } }), d);
    expect(r.result).toBe("unknown_account"); expect(updates).toHaveLength(0);
  });
  it("Viva unavailable -> 503 retry, nothing changed", async () => {
    const { d, updates } = deps({ fetchFn: vivaReturns({}, false) });
    expect((await handleOnboardingWebhook(evt(), d)).status).toBe(503); expect(updates).toHaveLength(0);
  });
  it("missing ISV token -> 503, never merchant fallback", async () => {
    const { d, updates } = deps({ getIsvToken: async () => null });
    expect((await handleOnboardingWebhook(evt(), d)).status).toBe(503); expect(updates).toHaveLength(0);
  });
  it("Viva response for another account is rejected", async () => {
    const { d, updates } = deps({ fetchFn: vivaReturns({ accountId: ACC_B, merchantId: MID_A, verified: true }) });
    expect((await handleOnboardingWebhook(evt(), d)).result).toBe("retry_viva_unavailable"); expect(updates).toHaveLength(0);
  });
  it("demo row is not updated by a live event", async () => {
    const { d } = deps({ findByAccountId: async () => row({ is_demo: true }) });
    expect((await handleOnboardingWebhook(evt(), d)).result).toBe("env_mismatch");
  });
  it("existing merchantId is never rebound", () => {
    expect(deriveUpdate(row({ viva_merchant_id: "bbbbbbbb-0000-4000-8000-00000000000b" }), { accountId: ACC_A, merchantId: MID_A, verified: true })).toBeNull();
  });
});

describe("sync: tenant from session only", () => {
  it("body user_id of another salon is ignored", async () => {
    const asked: string[] = [];
    const { d } = deps({ findByUser: async (u: string) => (asked.push(u), u === "salon-a" ? row() : null) });
    await syncForSession("salon-a", { user_id: "salon-b", viva_account_id: ACC_B }, d);
    expect(asked).toEqual(["salon-a"]);
  });
  it("no session -> 401", async () => {
    const { d } = deps({ findByUser: async () => row() });
    expect((await syncForSession(null, { user_id: "salon-a" }, d)).status).toBe(401);
  });
  it("Viva down -> 503, no update", async () => {
    const { d, updates } = deps({ fetchFn: vivaReturns({}, false), findByUser: async () => row() });
    expect((await syncForSession("salon-a", {}, d)).status).toBe(503); expect(updates).toHaveLength(0);
  });
});

describe("live payment gate", () => {
  const full = row({ onboarding_status: "active", kyc_status: "verified", viva_merchant_id: MID_A, viva_source_code: "1234" });
  it("allowed only when active + verified + merchantId + sourceCode", () => expect(livePaymentAllowed(full).ok).toBe(true));
  it("KYC pending blocks", () => expect(livePaymentAllowed({ ...full, kyc_status: "pending" }).reason).toBe("kyc_not_verified"));
  it("rejected blocks", () => expect(livePaymentAllowed({ ...full, onboarding_status: "rejected" }).ok).toBe(false));
  it("connected (not yet verified) blocks", () => expect(livePaymentAllowed({ ...full, onboarding_status: "connected" }).ok).toBe(false));
  it("missing source code blocks", () => expect(livePaymentAllowed({ ...full, viva_source_code: "" }).reason).toBe("source_code_missing"));
  it("demo row never counts as live", () => expect(livePaymentAllowed({ ...full, is_demo: true }).ok).toBe(false));
});

describe("idempotent create", () => {
  it("repeat create reuses the existing account and link", () => expect(decideCreate(row())).toEqual({ action: "reuse", redirectUrl: "https://x.example/onb" }));
  it("no account -> create", () => expect(decideCreate(null).action).toBe("create"));
  it("already active -> refuse", () => expect(decideCreate(row({ onboarding_status: "active" })).action).toBe("refuse"));
  it("rejected reconnect needs manual review", () => expect(decideCreate(row({ onboarding_status: "rejected" }), { reconnect: true }).action).toBe("refuse"));
  it("parses redirectUrl per contract, rejects legacy onboardingUrl", () => {
    expect(parseCreate({ accountId: ACC_A, redirectUrl: "https://demo.vivapayments.com/onb/1" })?.redirectUrl).toContain("https://");
    expect(parseCreate({ accountId: ACC_A, onboardingUrl: "https://x" })).toBeNull();
  });
});
