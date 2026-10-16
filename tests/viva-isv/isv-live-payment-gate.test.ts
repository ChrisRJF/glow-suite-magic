import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { livePaymentGate } from "../../supabase/functions/_shared/inactive/isvLivePaymentGate";

const T = "tenant-1", ACC = "11111111-2222-4333-8444-555555555555", MID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ON = { VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_LIVE_CLIENT_ID: "id", VIVA_ISV_LIVE_CLIENT_SECRET: "s" } as Record<string, string>;
const kyc = (o: any = {}) => ({ is_demo: false, viva_merchant_id: MID, viva_source_code: "1234", onboarding_status: "active", kyc_status: "verified", setup_complete: true, terminals_enabled: true, online_payments_enabled: true, ...o });
const row = (o: any = {}) => ({ id: "r", user_id: T, is_demo: false, viva_account_id: ACC, viva_merchant_id: MID, viva_source_code: "1234", onboarding_status: "active", kyc_status: "verified", ...o });

function admin(o: { settings?: any; kyc?: any; rows?: any } = {}) {
  return { from(t: string) {
    const q: any = { select: () => q, eq: () => q, order: () => q, maybeSingle: async () => ({ data: o.kyc === undefined ? kyc() : o.kyc, error: null }),
      limit: async () => t === "settings" ? (o.settings === null ? { data: null, error: { m: 1 } } : { data: [o.settings ?? { is_demo: false, demo_mode: false }], error: null })
        : { data: o.rows ?? [row()], error: null } };
    return q;
  } };
}
function run(o: any = {}, method: "link" | "terminal" = "link") {
  const calls: string[] = [];
  const f = (async (url: string) => { calls.push(url);
    if (url.endsWith("/connect/token")) return new Response(JSON.stringify({ access_token: "t" }));
    return new Response(JSON.stringify(o.retrieve ?? { accountId: ACC, verified: true, acquiringEnabled: true, merchantId: MID }));
  }) as any;
  return livePaymentGate(T, method, { admin: admin(o), env: (n) => (o.env ?? ON)[n], fetch: f, providerEnv: o.providerEnv ?? "live" }).then((r) => ({ r, calls }));
}

describe("LIVE payment gate (Smart Checkout + Cloud Terminal)", () => {
  it("fully verified live salon passes for link and terminal", async () => {
    expect((await run()).r).toEqual({ ok: true, demo: false });
    expect((await run({}, "terminal")).r).toEqual({ ok: true, demo: false });
  });
  it("demo salon: allowed as demo, no Viva calls", async () => {
    const { r, calls } = await run({ settings: { is_demo: true } });
    expect(r).toEqual({ ok: true, demo: true }); expect(calls.length).toBe(0);
  });
  it("demo salon + provider env 'live' -> fail closed, zero Viva calls (POS live host)", async () => {
    const { r, calls } = await run({ settings: { is_demo: true }, providerEnv: "live" });
    expect(r).toEqual({ ok: false, demo: true, reason: "environment_mismatch" }); expect(calls.length).toBe(0);
  });
  it("demo salon + provider env 'demo' -> allowed, zero Viva calls", async () => {
    const { r, calls } = await run({ settings: { is_demo: true }, providerEnv: "demo" });
    expect(r).toEqual({ ok: true, demo: true }); expect(calls.length).toBe(0);
  });
  it("settings unreadable -> block", async () => expect((await run({ settings: null })).r.ok).toBe(false));
  it("flag off -> block, zero provider calls", async () => {
    const { r, calls } = await run({ env: {} });
    expect(r).toMatchObject({ ok: false, reason: "live_isv_disabled" }); expect(calls.length).toBe(0);
  });
  it("provider env not live -> block", async () => expect((await run({ providerEnv: "demo" })).r.ok).toBe(false));
  it("missing KYC / source / capability -> block without Viva calls", async () => {
    for (const k of [kyc({ kyc_status: "pending" }), kyc({ viva_source_code: "" }), kyc({ online_payments_enabled: false }), null]) {
      const { r, calls } = await run({ kyc: k }); expect(r.ok).toBe(false); expect(calls.length).toBe(0);
    }
    expect((await run({ kyc: kyc({ terminals_enabled: false }) }, "terminal")).r.ok).toBe(false);
  });
  it("multiple/other-tenant rows -> block", async () => {
    expect((await run({ rows: [row(), row({ id: "x" })] })).r.ok).toBe(false);
    expect((await run({ rows: [row({ user_id: "other" })] })).r.ok).toBe(false);
  });
  it("Retrieve must be verified, acquiring, and return the exact merchantId", async () => {
    for (const ret of [{ accountId: ACC, verified: false, acquiringEnabled: true, merchantId: MID },
      { accountId: ACC, verified: true, acquiringEnabled: false, merchantId: MID },
      { accountId: ACC, verified: true, acquiringEnabled: true, merchantId: "" },
      { accountId: ACC, verified: true, acquiringEnabled: true, merchantId: "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee" }]) {
      expect((await run({ retrieve: ret })).r.ok).toBe(false);
    }
  });
  it("both endpoints call the gate before provider calls and ignore body is_demo", () => {
    const sc = readFileSync("supabase/functions/create-viva-payment/index.ts", "utf8");
    expect(sc.indexOf('livePaymentGate(ownerId, "link"')).toBeGreaterThan(0);
    expect(sc.indexOf('livePaymentGate(ownerId, "link"')).toBeLessThan(sc.indexOf("requireMerchantContext(admin, ownerId)"));
    expect(sc).toContain("const demoMode = gate.demo === true;");
    const tp = readFileSync("supabase/functions/create-viva-terminal-payment/index.ts", "utf8");
    const g = tp.indexOf('livePaymentGate(userId, "terminal"');
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(tp.indexOf("requireMerchantContext(admin, userId)"));
    expect(g).toBeLessThan(tp.indexOf("await fetch(url"));
    expect(tp).toContain("is_demo = gate.demo;");
  });
});
