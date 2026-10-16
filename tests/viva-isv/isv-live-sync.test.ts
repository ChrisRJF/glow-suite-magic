import { describe, it, expect } from "vitest";
import { syncLiveForSession } from "../../supabase/functions/_shared/inactive/isvLiveConfig";
import type { MerchantRow } from "../../supabase/functions/_shared/inactive/isvOnboardingSafety";

// Fictitious values only; no network.
const ACC = "11111111-aaaa-4aaa-8aaa-111111111111";
const MID = "aaaaaaaa-0000-4000-8000-00000000000a";
const ON: Record<string, string> = { VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_LIVE_CLIENT_ID: "fake-id", VIVA_ISV_LIVE_CLIENT_SECRET: "fake-secret", VIVA_ISV_LIVE_PILOT_USER_IDS: "11111111-aaaa-4bbb-8ccc-000000000001", VIVA_ENVIRONMENT: "demo", VIVA_ISV_CLIENT_ID: "demo-id" };
const row = (o: Partial<MerchantRow> = {}): MerchantRow => ({ id: "r", user_id: "11111111-aaaa-4bbb-8ccc-000000000001", is_demo: false, viva_account_id: ACC,
  viva_merchant_id: null, viva_source_code: null, onboarding_status: "invited", kyc_status: null, onboarding_url: null, ...o });

function deps(env: Record<string, string>, opts: { row?: MerchantRow | null | "error"; acct?: unknown; ok?: boolean } = {}) {
  const calls: string[] = []; const reads: string[] = []; const updates: any[] = [];
  return { calls, reads, updates, d: {
    get: (n: string) => env[n],
    fetchFn: async (url: string) => {
      calls.push(url);
      if (url.endsWith("/connect/token")) return new Response(JSON.stringify({ access_token: "t" }));
      return new Response(JSON.stringify(opts.acct ?? {}), { status: opts.ok === false ? 500 : 200 });
    },
    findLiveRowByUser: async (u: string) => (reads.push(u), opts.row === undefined ? row() : opts.row),
    update: async (id: string, u: string, upd: any) => (updates.push({ id, u, upd }), true),
  } };
}

describe("LIVE sync-viva-connected-account core", () => {
  it("no session -> 401, no reads", async () => {
    const t = deps(ON); expect((await syncLiveForSession(null, t.d)).status).toBe(401); expect(t.reads).toHaveLength(0);
  });
  it("switch absent -> 503 before any read or network", async () => {
    const { VIVA_ISV_LIVE_ENABLED: _, ...off } = ON; const t = deps(off);
    expect(await syncLiveForSession("11111111-aaaa-4bbb-8ccc-000000000001", t.d)).toEqual({ status: 503, result: "live_isv_disabled" });
    expect(t.reads).toHaveLength(0); expect(t.calls).toHaveLength(0);
  });
  it("demo/merchant credentials never substitute for LIVE ones", async () => {
    const t = deps({ VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_CLIENT_ID: "x", VIVA_ISV_CLIENT_SECRET: "y", VIVA_CLIENT_ID: "x", VIVA_CLIENT_SECRET: "y" });
    expect((await syncLiveForSession("11111111-aaaa-4bbb-8ccc-000000000001", t.d)).result).toBe("live_isv_credentials_missing"); expect(t.calls).toHaveLength(0);
  });
  it("only LIVE hosts are called", async () => {
    const t = deps(ON, { acct: { accountId: ACC, verified: false, acquiringEnabled: false } });
    await syncLiveForSession("11111111-aaaa-4bbb-8ccc-000000000001", t.d);
    expect(t.calls.every((u) => u.startsWith("https://accounts.vivapayments.com") || u.startsWith("https://api.vivapayments.com"))).toBe(true);
  });
  it("tenant comes from session only", async () => {
    const t = deps(ON, { acct: { accountId: ACC, verified: false, acquiringEnabled: false } });
    await syncLiveForSession("11111111-aaaa-4bbb-8ccc-000000000001", t.d); expect(t.reads).toEqual(["11111111-aaaa-4bbb-8ccc-000000000001"]); expect(t.updates[0].u).toBe("11111111-aaaa-4bbb-8ccc-000000000001");
  });
  it("row of another tenant is refused", async () => {
    const t = deps(ON, { row: row({ user_id: "salon-b" }) });
    expect((await syncLiveForSession("11111111-aaaa-4bbb-8ccc-000000000001", t.d)).result).toBe("tenant_mismatch"); expect(t.updates).toHaveLength(0);
  });
  it("demo row is never touched", async () => {
    const t = deps(ON, { row: row({ is_demo: true }) });
    expect((await syncLiveForSession("11111111-aaaa-4bbb-8ccc-000000000001", t.d)).result).toBe("not_live_env"); expect(t.calls).toHaveLength(0);
  });
  it("Viva down or unparseable -> 503, nothing written", async () => {
    const a = deps(ON, { ok: false }); expect((await syncLiveForSession("11111111-aaaa-4bbb-8ccc-000000000001", a.d)).status).toBe(503); expect(a.updates).toHaveLength(0);
    const b = deps(ON, { acct: { accountId: ACC, verified: "yes" } }); expect((await syncLiveForSession("11111111-aaaa-4bbb-8ccc-000000000001", b.d)).status).toBe(503); expect(b.updates).toHaveLength(0);
  });
  it("storage error or multiple rows -> 503", async () => {
    const t = deps(ON, { row: "error" }); expect((await syncLiveForSession("11111111-aaaa-4bbb-8ccc-000000000001", t.d)).status).toBe(503);
  });
  it("verified update never sets source code; merchant id never rebound", async () => {
    const t = deps(ON, { acct: { accountId: ACC, verified: true, acquiringEnabled: true, merchantId: MID } });
    expect((await syncLiveForSession("11111111-aaaa-4bbb-8ccc-000000000001", t.d)).status).toBe(200);
    expect(t.updates[0].upd).not.toHaveProperty("viva_source_code");
    const r = deps(ON, { row: row({ viva_merchant_id: "bbbbbbbb-0000-4000-8000-00000000000b" }), acct: { accountId: ACC, verified: true, acquiringEnabled: true, merchantId: MID } });
    expect((await syncLiveForSession("11111111-aaaa-4bbb-8ccc-000000000001", r.d)).result).toBe("rejected_mismatch"); expect(r.updates).toHaveLength(0);
  });
});
