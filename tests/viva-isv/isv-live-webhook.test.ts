import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { handleIsvOnboardingEvent, isIsvOnboardingEvent, refreshLiveMerchants, type IsvWebhookDeps } from "../../supabase/functions/_shared/inactive/isvLiveWebhook";

const ACC = "11111111-2222-4333-8444-555555555555";
const MID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ON = { VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_LIVE_CLIENT_ID: "id", VIVA_ISV_LIVE_CLIENT_SECRET: "s" } as Record<string, string>;
const row = (o: any = {}) => ({ id: "r1", user_id: "11111111-aaaa-4bbb-8ccc-000000000001", is_demo: false, viva_account_id: ACC, viva_merchant_id: null, viva_source_code: null, onboarding_status: "invited", kyc_status: "pending", ...o });
const forged = { ConnectedAccountId: ACC, MerchantId: MID, Verified: true, OnboardingStatus: "active", SourceCode: "9999", OnlinePaymentsEnabled: true };

function deps(o: { env?: any; rows?: any[] | null; retrieve?: any; token?: boolean; updOk?: boolean } = {}) {
  const calls: string[] = []; const updates: any[] = [];
  const d: IsvWebhookDeps = {
    env: (n) => (o.env ?? ON)[n],
    fetch: (async (url: string) => {
      calls.push(url);
      if (url.endsWith("/connect/token")) return new Response(JSON.stringify(o.token === false ? {} : { access_token: "t" }), { status: o.token === false ? 401 : 200 });
      return o.retrieve === null ? new Response("x", { status: 500 }) : new Response(JSON.stringify(o.retrieve ?? { accountId: ACC, verified: false, acquiringEnabled: false, merchantId: "" }));
    }) as any,
    findLiveRows: async () => (o.rows === undefined ? [row()] : o.rows),
    updateRow: async (_r, u) => { updates.push(u); return o.updOk !== false; },
  };
  return { d, calls, updates };
}

describe("ISV onboarding webhook 8193/8194", () => {
  it("only intercepts 8193/8194, not payment events", () => {
    expect(isIsvOnboardingEvent(8193)).toBe(true); expect(isIsvOnboardingEvent(8194)).toBe(true);
    for (const t of [1796, 1797, 1798, 1799, null]) expect(isIsvOnboardingEvent(t as any)).toBe(false);
  });
  it("flag off: zero Viva calls and no writes", async () => {
    const { d, calls, updates } = deps({ env: {} });
    expect((await handleIsvOnboardingEvent(forged, d)).note).toBe("isv_onboarding_live_disabled");
    expect(calls.length + updates.length).toBe(0);
  });
  it("forged verified/sourceCode in body never applied; Retrieve decides", async () => {
    const { d, updates } = deps();
    const r = await handleIsvOnboardingEvent(forged, d);
    expect(r.processed).toBe(true);
    expect(updates[0].onboarding_status).toBe("invited");
    expect(updates[0].viva_source_code).toBeUndefined();
    expect(updates[0].online_payments_enabled).toBe(false);
    expect(updates[0].viva_merchant_id).toBeUndefined();
  });
  it("verified Retrieve updates status from provider only", async () => {
    const { d, calls, updates } = deps({ retrieve: { accountId: ACC, verified: true, acquiringEnabled: true, merchantId: MID } });
    await handleIsvOnboardingEvent({ ConnectedAccountId: ACC }, d);
    expect(calls[1]).toBe(`https://api.vivapayments.com/isv/v1/accounts/${ACC}`);
    expect(updates[0]).toMatchObject({ onboarding_status: "active", kyc_status: "verified", viva_merchant_id: MID });
    expect(updates[0].online_payments_enabled).toBe(false);
  });
  it("periodic refresh with contract gate OFF never reads or changes any salon", async () => {
    let reads = 0;
    const admin = { from: () => { reads++; throw new Error("must not read"); } };
    expect(await refreshLiveMerchants(admin, (n) => ON[n])).toMatchObject({ scanned: 0, synced: 0, blocked: "live_contract_gate_off" });
    expect(reads).toBe(0);
  });
  it("token/Retrieve/update/lookup failures: no status update, retry 503", async () => {
    for (const o of [{ token: false }, { retrieve: null }, { rows: null }]) {
      const { d, updates } = deps(o as any); const r = await handleIsvOnboardingEvent(forged, d);
      expect(r).toMatchObject({ processed: false, status: 503 }); expect(updates.length).toBe(0);
    }
    const r = await handleIsvOnboardingEvent(forged, deps({ updOk: false }).d);
    expect(r).toMatchObject({ processed: false, status: 503 });
  });
  it("merchant ID mismatch rejected", async () => {
    const { d, updates } = deps({ rows: [row({ viva_merchant_id: "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee" })], retrieve: { accountId: ACC, verified: true, acquiringEnabled: true, merchantId: MID } });
    expect((await handleIsvOnboardingEvent(forged, d)).note).toBe("isv_onboarding_identity_mismatch_hold");
    expect(updates.length).toBe(0);
  });
  it("demo rows, unknown account, MerchantId-only payload: untouched, no Viva calls", async () => {
    for (const [body, rows] of [[forged, [row({ is_demo: true })]], [forged, []], [{ MerchantId: MID }, [row()]]] as any[]) {
      const { d, calls, updates } = deps({ rows });
      expect((await handleIsvOnboardingEvent(body, d)).processed).toBe(true);
      expect(calls.length + updates.length).toBe(0);
    }
  });
  it("legacy heuristic onboarding block removed from viva-webhook", () => {
    const src = readFileSync("supabase/functions/viva-webhook/index.ts", "utf8");
    for (const s of ["OnboardingStatus", "PayoutsEnabled", "OnlinePaymentsEnabled", "evtSourceCode"]) expect(src).not.toContain(s);
  });
});

describe("viva-webhook updateRow guard", () => {
  const src = readFileSync("supabase/functions/viva-webhook/index.ts", "utf8");
  it("requires exactly one updated row", () => {
    expect(src).toContain('.eq("viva_account_id", row.viva_account_id!)\n          .select("id");');
    expect(src).toContain("return !error && Array.isArray(data) && data.length === 1;");
  });
  it("0 or >1 affected rows (updateRow false) -> 503, unprocessed", async () => {
    const r = await handleIsvOnboardingEvent(forged, deps({ updOk: false }).d);
    expect(r).toMatchObject({ processed: false, status: 503, note: "isv_onboarding_update_failed" });
  });
});
