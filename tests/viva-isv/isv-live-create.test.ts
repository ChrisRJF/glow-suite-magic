import { describe, expect, it } from "vitest";
import { liveCreateForSession, type LiveCreateDeps, type LiveMerchantRow } from "../../supabase/functions/_shared/inactive/isvLiveCreate";
import type { ClaimRow, ReservationStore } from "../../supabase/functions/_shared/inactive/isvCreateReservation";

const ACC = "11111111-2222-3333-4444-555555555555";
function store(): ReservationStore {
  let r: ClaimRow | null = null;
  return {
    async claim(_u, _d, a) { if (!r) r = { state: "reserved", attempt_id: a, provider_account_id: null, invitation_url: null }; return { ...r }; },
    async markDispatching(_u, _d, a) { if (r?.attempt_id === a && r.state === "reserved") { r.state = "dispatching"; return true; } return false; },
    async complete(_u, _d, a, acc, url) { if (r?.attempt_id === a) { Object.assign(r, { state: "completed", provider_account_id: acc, invitation_url: url }); return true; } return false; },
    async hold(_u, _d, a) { if (r?.attempt_id === a) { r.state = "reconciliation_required"; return true; } return false; },
    async release() { r = null; return true; },
  };
}
function deps(o: Partial<LiveCreateDeps> & { enabled?: boolean; providerOk?: boolean; row?: LiveMerchantRow | null } = {}) {
  const calls: string[] = []; let n = 0;
  const env: Record<string, string> = { VIVA_ISV_LIVE_CLIENT_ID: "x", VIVA_ISV_LIVE_CLIENT_SECRET: "y" };
  if (o.enabled !== false) env.VIVA_ISV_LIVE_ENABLED = "true";
  const fetchFn = (async (url: string) => {
    calls.push(String(url));
    if (String(url).includes("/connect/token")) return new Response(JSON.stringify({ access_token: "t" }));
    if (o.providerOk === false) return new Response("err", { status: 500 });
    return new Response(JSON.stringify({ accountId: ACC, invitation: { redirectUrl: "https://www.vivapayments.com/invite/x" } }));
  }) as typeof fetch;
  const d: LiveCreateDeps = {
    get: (k) => env[k], fetchFn, store: store(), newAttemptId: () => `a${++n}`,
    findLiveRow: async () => o.row ?? null, persist: async () => true, ...o,
  };
  return { d, calls, posts: () => calls.filter((c) => c.endsWith("/isv/v1/accounts")).length };
}

describe("LIVE ISV create wiring", () => {
  it("flag absent: no DB, token or Viva call", async () => {
    let reads = 0; const t = deps({ enabled: false, findLiveRow: async () => { reads++; return null; } });
    const r = await liveCreateForSession("u1", "a@b.nl", t.d);
    expect(r).toEqual({ status: 503, body: { error: "live_isv_disabled" } });
    expect(t.calls.length + reads).toBe(0);
  });
  it("row of another tenant is refused without POST", async () => {
    const t = deps({ row: { id: "m", user_id: "u2", is_demo: false, viva_account_id: null, onboarding_url: null } });
    expect((await liveCreateForSession("u1", "a@b.nl", t.d)).status).toBe(403); expect(t.posts()).toBe(0);
  });
  it("existing account is reused, never re-created", async () => {
    const t = deps({ row: { id: "m", user_id: "u1", is_demo: false, viva_account_id: ACC, onboarding_url: "https://www.vivapayments.com/i" } });
    expect((await liveCreateForSession("u1", "a@b.nl", t.d)).body).toMatchObject({ status: "reused" }); expect(t.calls.length).toBe(0);
  });
  it("existing account without trusted URL needs manual recovery", async () => {
    const t = deps({ row: { id: "m", user_id: "u1", is_demo: false, viva_account_id: ACC, onboarding_url: "http://evil.com" } });
    expect((await liveCreateForSession("u1", "a@b.nl", t.d)).status).toBe(409); expect(t.calls.length).toBe(0);
  });
  it("two concurrent requests: one POST", async () => {
    const t = deps();
    const rs = await Promise.all([liveCreateForSession("u1", "a@b.nl", t.d), liveCreateForSession("u1", "a@b.nl", t.d)]);
    expect(t.posts()).toBe(1); expect(rs.map((r) => (r.body as any).status).sort()).toEqual(["busy", "created"]);
  });
  it("provider 5xx is held for reconciliation, retry never POSTs", async () => {
    const t = deps({ providerOk: false });
    expect((await liveCreateForSession("u1", "a@b.nl", t.d)).body).toEqual({ status: "reconciliation_required" });
    await liveCreateForSession("u1", "a@b.nl", t.d); expect(t.posts()).toBe(1);
  });
  it("merchant persistence failure reports pending, not success", async () => {
    const t = deps({ persist: async () => false });
    expect(await liveCreateForSession("u1", "a@b.nl", t.d)).toEqual({ status: 202, body: { status: "persistence_pending" } });
  });
});
