import { describe, expect, it } from "vitest";
import { reservedCreate, type ClaimRow, type ReservationStore, type ProviderOutcome } from "../../supabase/functions/_shared/inactive/isvCreateReservation";

// In-memory model of the proposed SQL semantics (fictitious).
function memStore(opts: { failComplete?: boolean; failDispatch?: boolean } = {}) {
  const rows = new Map<string, ClaimRow & { at: number }>();
  const k = (u: string, d: boolean) => `${u}:${d}`;
  let now = 0;
  const s: ReservationStore & { rows: typeof rows; tick(ms: number): void } = {
    rows, tick(ms) { now += ms; },
    async claim(u, d, a) {
      const r = rows.get(k(u, d));
      if (!r || (r.state === "reserved" && now - r.at > 120_000)) rows.set(k(u, d), { state: "reserved", attempt_id: a, provider_account_id: null, invitation_url: null, at: now });
      const x = rows.get(k(u, d))!; return { ...x };
    },
    async markDispatching(u, d, a) { if (opts.failDispatch) throw new Error("db"); const r = rows.get(k(u, d)); if (r?.attempt_id === a && r.state === "reserved") { r.state = "dispatching"; return true; } return false; },
    async complete(u, d, a, acc, url) { if (opts.failComplete) throw new Error("db"); const r = rows.get(k(u, d)); if (r?.attempt_id === a && r.state === "dispatching") { Object.assign(r, { state: "completed", provider_account_id: acc, invitation_url: url }); return true; } return false; },
    async hold(u, d, a) { const r = rows.get(k(u, d)); if (r?.attempt_id === a && r.state === "dispatching") { r.state = "reconciliation_required"; return true; } return false; },
    async release(u, d, a) { const r = rows.get(k(u, d)); if (r?.attempt_id === a) { rows.delete(k(u, d)); return true; } return false; },
  };
  return s;
}
const ok: ProviderOutcome = { kind: "created", accountId: "acc-fake-0001", redirectUrl: "https://demo.vivapayments.com/invite/x" };
const run = (store: ReservationStore, attemptId: string, post: () => Promise<ProviderOutcome>, persist = async () => true) =>
  reservedCreate({ sessionUserId: "u1", rowUserId: "u1", isDemo: false, attemptId, store, post, persistMerchant: persist });

describe("ISV create reservation", () => {
  it("two concurrent requests: exactly one external POST", async () => {
    const s = memStore(); let posts = 0;
    const post = async () => { posts++; return ok; };
    const [a, b] = await Promise.all([run(s, "a1", post), run(s, "a2", post)]);
    expect(posts).toBe(1);
    expect([a.status, b.status].sort()).toEqual(["busy", "created"]);
  });
  it("completed reservation is reused without POST", async () => {
    const s = memStore(); await run(s, "a1", async () => ok); let posts = 0;
    const r = await run(s, "a2", async () => { posts++; return ok; });
    expect(posts).toBe(0); expect(r.status).toBe("reused");
  });
  it("timeout after dispatch holds for reconciliation and never retries", async () => {
    const s = memStore(); let posts = 0;
    expect((await run(s, "a1", async () => { posts++; throw new Error("timeout"); })).status).toBe("reconciliation_required");
    s.tick(10 * 60_000);
    expect((await run(s, "a2", async () => { posts++; return ok; })).status).toBe("reconciliation_required");
    expect(posts).toBe(1);
  });
  it("crash after provider success before journal: dispatching row blocks new create", async () => {
    const s = memStore(); s.rows.set("u1:false", { state: "dispatching", attempt_id: "dead", provider_account_id: null, invitation_url: null, at: 0 });
    s.tick(60 * 60_000); let posts = 0;
    expect((await run(s, "a2", async () => { posts++; return ok; })).status).toBe("busy");
    expect(posts).toBe(0);
  });
  it("journal write failure after provider success: no second POST", async () => {
    const s = memStore({ failComplete: true }); let posts = 0;
    expect((await run(s, "a1", async () => { posts++; return ok; })).status).toBe("reconciliation_required");
    expect((await run(s, "a2", async () => { posts++; return ok; })).status).toBe("reconciliation_required");
    expect(posts).toBe(1);
  });
  it("merchant persistence failure retries only persistence", async () => {
    const s = memStore(); let posts = 0;
    const r1 = await run(s, "a1", async () => { posts++; return ok; }, async () => { throw new Error("db"); });
    expect(r1).toMatchObject({ status: "created", persisted: false });
    const r2 = await run(s, "a2", async () => { posts++; return ok; });
    expect(r2).toMatchObject({ status: "reused", persisted: true, accountId: "acc-fake-0001" });
    expect(posts).toBe(1);
  });
  it("definite rejection releases so a later attempt may create", async () => {
    const s = memStore(); let posts = 0;
    expect((await run(s, "a1", async () => { posts++; return { kind: "rejected" }; })).status).toBe("rejected");
    expect((await run(s, "a2", async () => { posts++; return ok; })).status).toBe("created");
    expect(posts).toBe(2);
  });
  it("fence persistence failure: no POST", async () => {
    const s = memStore({ failDispatch: true }); let posts = 0;
    expect((await run(s, "a1", async () => { posts++; return ok; })).status).toBe("busy");
    expect(posts).toBe(0);
  });
  it("stale never-dispatched reservation can be taken over", async () => {
    const s = memStore(); await s.claim("u1", false, "old"); s.tick(5 * 60_000);
    expect((await run(s, "a2", async () => ok)).status).toBe("created");
  });
  it("session mismatch: no claim, no POST", async () => {
    const s = memStore(); let posts = 0;
    const r = await reservedCreate({ sessionUserId: "u2", rowUserId: "u1", isDemo: false, attemptId: "a", store: s, post: async () => { posts++; return ok; }, persistMerchant: async () => true });
    expect(r.status).toBe("unavailable"); expect(posts).toBe(0); expect(s.rows.size).toBe(0);
  });
});
