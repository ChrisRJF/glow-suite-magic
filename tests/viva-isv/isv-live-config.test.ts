import { describe, it, expect } from "vitest";
import {
  LIVE_ISV_SECRET_NAMES, loadLiveIsvConfig, liveIsvStatus, getLiveIsvToken, createLiveAccount, retrieveLiveAccount, liveAccountStatus, scopedEnv,
} from "../../supabase/functions/_shared/inactive/isvLiveConfig";
import { GLOWPAY_LOGO_URL } from "../../supabase/functions/_shared/inactive/isvOnboardingV2";
import type { MerchantRow } from "../../supabase/functions/_shared/inactive/isvOnboardingSafety";

// Fictitious values only.
const ACC = "11111111-aaaa-4aaa-8aaa-111111111111";
const MID = "aaaaaaaa-0000-4000-8000-00000000000a";
const envOf = (o: Record<string, string>) => (n: string) => o[n];
const ON = envOf({ VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_LIVE_CLIENT_ID: "fake-id", VIVA_ISV_LIVE_CLIENT_SECRET: "fake-secret" });
const row = (o: Partial<MerchantRow> = {}): MerchantRow => ({ id: "r", user_id: "salon-a", is_demo: false, viva_account_id: null,
  viva_merchant_id: null, viva_source_code: null, onboarding_status: "not_started", kyc_status: null, onboarding_url: null, ...o });
const input = { email: "a@test.example", returnUrl: "https://glowsuite.nl/glowpay", branding: { partnerName: "GlowPay", logoUrl: GLOWPAY_LOGO_URL, primaryColor: "#123456" } };

function viva(routes: Record<string, unknown>, calls: string[] = []) {
  return async (url: string) => {
    calls.push(url);
    const k = Object.keys(routes).find((p) => url.includes(p));
    return k ? new Response(JSON.stringify(routes[k])) : new Response("", { status: 500 });
  };
}
const TOKEN = { "/connect/token": { access_token: "fake-token" } };

describe("secret names and isolation", () => {
  it("uses only the separate LIVE names", () => expect(Object.values(LIVE_ISV_SECRET_NAMES)).toEqual(["VIVA_ISV_LIVE_CLIENT_ID", "VIVA_ISV_LIVE_CLIENT_SECRET", "VIVA_ISV_LIVE_ENABLED"]));
  it("cannot see demo ISV, merchant or VIVA_ENVIRONMENT", () => {
    const g = scopedEnv(envOf({ VIVA_ENVIRONMENT: "production", VIVA_ISV_CLIENT_ID: "x", VIVA_CLIENT_SECRET: "y" }));
    ["VIVA_ENVIRONMENT", "VIVA_ISV_CLIENT_ID", "VIVA_CLIENT_SECRET"].forEach((n) => expect(g(n)).toBeUndefined());
  });
  it("demo ISV credentials never satisfy LIVE", () => expect(loadLiveIsvConfig(envOf({ VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_CLIENT_ID: "x", VIVA_ISV_CLIENT_SECRET: "y" }))).toEqual({ ok: false, reason: "live_isv_credentials_missing" }));
});

describe("fail closed config", () => {
  it("credentials present but switch absent -> disabled", () => expect(loadLiveIsvConfig(envOf({ VIVA_ISV_LIVE_CLIENT_ID: "a", VIVA_ISV_LIVE_CLIENT_SECRET: "b" })).ok).toBe(false));
  it("status exposes booleans only, no values", () => {
    const s = liveIsvStatus(ON);
    expect(s.ready).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/fake-id|fake-secret/);
  });
  it("disabled -> no network call at all", async () => {
    const calls: string[] = [];
    expect(await getLiveIsvToken(envOf({}), viva(TOKEN, calls))).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("token endpoint failure -> null", async () => expect(await getLiveIsvToken(ON, viva({}))).toBeNull());
  it("token goes to LIVE accounts host", async () => {
    const calls: string[] = [];
    expect(await getLiveIsvToken(ON, viva(TOKEN, calls))).toBe("fake-token");
    expect(calls[0]).toBe("https://accounts.vivapayments.com/connect/token");
  });
});

describe("create", () => {
  const created = { ...TOKEN, "/isv/v1/accounts": { accountId: ACC, invitation: { redirectUrl: "https://www.vivapayments.com/inv/1" } } };
  it("creates on LIVE API host", async () => {
    const calls: string[] = [];
    const r = await createLiveAccount(null, input, ON, viva(created, calls));
    expect(r).toMatchObject({ ok: true, action: "created", accountId: ACC });
    expect(calls[1]).toBe("https://api.vivapayments.com/isv/v1/accounts");
  });
  it("missing brand colour refuses before any call", async () => {
    const calls: string[] = [];
    const r = await createLiveAccount(null, { ...input, branding: { ...input.branding, primaryColor: null } }, ON, viva(created, calls));
    expect(r).toEqual({ ok: false, reason: "invalid_payload" }); expect(calls).toHaveLength(0);
  });
  it("demo row never used for LIVE", async () => expect(await createLiveAccount(row({ is_demo: true, viva_account_id: ACC }), input, ON, viva(created))).toEqual({ ok: false, reason: "env_mismatch" }));
  it("existing account reuses link, no second account", async () => {
    const calls: string[] = [];
    const r = await createLiveAccount(row({ viva_account_id: ACC, onboarding_status: "invited", onboarding_url: "https://www.vivapayments.com/inv/1" }), input, ON, viva(created, calls));
    expect(r.ok && r.action).toBe("reuse"); expect(calls).toHaveLength(0);
  });
});

describe("retrieve and status", () => {
  const ret = (o: any) => ({ ...TOKEN, [`/isv/v1/accounts/${ACC}`]: { accountId: ACC, verified: true, acquiringEnabled: true, merchantId: MID, ...o } });
  const linked = row({ viva_account_id: ACC, viva_merchant_id: MID, viva_source_code: "fake-src", onboarding_status: "active" });
  it("strict parse", async () => expect(await retrieveLiveAccount(ACC, ON, viva(ret({ verified: "yes" })))).toBeNull());
  it("ready only when all confirmed", async () => expect((await liveAccountStatus(linked, ON, viva(ret({})))).ok).toBe(true));
  it("acquiring off blocks", async () => expect((await liveAccountStatus(linked, ON, viva(ret({ acquiringEnabled: false })))).reason).toBe("acquiring_disabled"));
  it("source code missing blocks", async () => expect((await liveAccountStatus({ ...linked, viva_source_code: null }, ON, viva(ret({})))).reason).toBe("source_code_missing"));
  it("switch off blocks before Viva", async () => expect((await liveAccountStatus(linked, envOf({}), viva(ret({})))).reason).toBe("live_isv_disabled"));
  it("Viva down blocks", async () => expect((await liveAccountStatus(linked, ON, viva(TOKEN))).ok).toBe(false));
});