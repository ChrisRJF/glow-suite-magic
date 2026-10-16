import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { liveWebhookVerificationKey } from "../../supabase/functions/_shared/inactive/isvLiveConfig";
import { liveCreateForSession, type LiveCreateDeps } from "../../supabase/functions/_shared/inactive/isvLiveCreate";
import { liveCreateAccess, LIVE_CREATE_MAX_ATTEMPTS_PER_HOUR, LIVE_CREATE_RATE_WINDOW_SECONDS } from "../../supabase/functions/_shared/inactive/isvLiveAccess";

const U = "11111111-2222-4333-8444-555555555555";
const g = (e: Record<string, string>) => (n: string) => e[n];
const ON = { VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_LIVE_CLIENT_ID: "x", VIVA_ISV_LIVE_CLIENT_SECRET: "y" };
const facts = { authEmail: "owner@salon.nl", emailConfirmed: true, isOwner: true, settingsFound: true, isDemo: false, salonName: "Salon" };

function deps(o: Partial<LiveCreateDeps> = {}, env: Record<string, string> = ON) {
  const calls: string[] = []; const seen = { reads: 0, limits: 0, bodies: [] as string[] };
  const d: LiveCreateDeps = {
    get: g(env),
    fetchFn: (async (u: string, init?: RequestInit) => { calls.push(String(u)); if (init?.body) seen.bodies.push(String(init.body));
      if (String(u).includes("/connect/token")) return new Response(JSON.stringify({ access_token: "t" }));
      return new Response(JSON.stringify({ accountId: "11111111-2222-3333-4444-555555555555", invitation: { redirectUrl: "https://www.vivapayments.com/i" } })); }) as any,
    store: { claim: async (_u: string, _d: boolean, a: string) => ({ state: "reserved", attempt_id: a, provider_account_id: null, invitation_url: null }),
      markDispatching: async () => true, complete: async () => true, hold: async () => true, release: async () => true } as any,
    newAttemptId: () => "a",
    tenantFacts: async () => facts,
    rateLimit: async () => { seen.limits++; return true; },
    findLiveRow: async () => { seen.reads++; return null; },
    persist: async () => true, ...o,
  };
  return { d, calls, seen };
}

describe("LIVE ISV general availability (no pilot list)", () => {
  it("any confirmed owner of a real salon can create; no pilot secret needed", async () => {
    const t = deps();
    expect((await liveCreateForSession(U, t.d)).body).toMatchObject({ status: "created" });
  });
  it("global switch off: nothing read or called", async () => {
    const t = deps({}, { VIVA_ISV_LIVE_CLIENT_ID: "x", VIVA_ISV_LIVE_CLIENT_SECRET: "y" });
    expect((await liveCreateForSession(U, t.d)).body).toEqual({ error: "live_isv_disabled" });
    expect(t.calls.length + t.seen.reads + t.seen.limits).toBe(0);
  });
  it.each([
    [{ isOwner: false }, "owner_required"], [{ emailConfirmed: false }, "email_not_confirmed"],
    [{ isDemo: true }, "demo_account"], [{ settingsFound: false }, "setup_incomplete"],
    [{ salonName: " " }, "salon_name_required"], [{ authEmail: null }, "invalid_email"],
  ])("refuses %o before any read or Viva call", async (patch, err) => {
    const t = deps({ tenantFacts: async () => ({ ...facts, ...patch }) });
    expect((await liveCreateForSession(U, t.d)).body).toEqual({ error: err });
    expect(t.calls.length + t.seen.reads + t.seen.limits).toBe(0);
  });
  it("facts unavailable fails closed", async () => {
    const t = deps({ tenantFacts: async () => "error" });
    expect((await liveCreateForSession(U, t.d)).status).toBe(503); expect(t.calls.length).toBe(0);
  });
  it("Viva receives the verified auth email only", async () => {
    const t = deps();
    await liveCreateForSession(U, t.d);
    expect(t.seen.bodies.some((b) => b.includes("owner@salon.nl"))).toBe(true);
  });
  it("rate limit: 3 per hour, limited or unknown means no Viva call", async () => {
    expect(LIVE_CREATE_MAX_ATTEMPTS_PER_HOUR).toBe(3); expect(LIVE_CREATE_RATE_WINDOW_SECONDS).toBe(3600);
    const lim = deps({ rateLimit: async () => false });
    expect(await liveCreateForSession(U, lim.d)).toEqual({ status: 429, body: { error: "rate_limited" } }); expect(lim.calls.length).toBe(0);
    const err = deps({ rateLimit: async () => "error" });
    expect((await liveCreateForSession(U, err.d)).status).toBe(503); expect(err.calls.length).toBe(0);
  });
  it("reusing an existing merchant link does not consume the limit", async () => {
    const t = deps({ findLiveRow: async () => ({ id: "m", user_id: U, is_demo: false, viva_account_id: "acc", onboarding_url: "https://www.vivapayments.com/i" }) });
    expect((await liveCreateForSession(U, t.d)).body).toMatchObject({ status: "reused" });
    expect(t.seen.limits).toBe(0); expect(t.calls.length).toBe(0);
  });
  it("access helper is fail closed on unknown input", () => expect(liveCreateAccess(null)).toEqual({ ok: false, status: 503, error: "unavailable" }));
  it("entrypoint derives facts server-side and uses the durable limiter", () => {
    const src = readFileSync("supabase/functions/create-viva-connected-account/index.ts", "utf8");
    expect(src).toContain('admin.rpc("has_role", { _user_id: uid, _role: "eigenaar" })');
    expect(src).toContain("authEmail: user.email");
    expect(src).toContain('admin.rpc("check_public_rate_limit"');
    expect(src).not.toMatch(/PILOT/);
  });
  it("webhook verification key only with switch and key; GET marker wired", () => {
    expect(liveWebhookVerificationKey(g({ VIVA_ISV_LIVE_WEBHOOK_VERIFICATION_KEY: "k" }))).toBeNull();
    expect(liveWebhookVerificationKey(g({ VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_LIVE_WEBHOOK_VERIFICATION_KEY: "k" }))).toBe("k");
    const src = readFileSync("supabase/functions/viva-webhook/index.ts", "utf8");
    const i = src.indexOf('searchParams.get("isv") === "1"');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(src.indexOf('["OPTIONS", "GET", "HEAD"].includes(method)'));
  });
});
