import { describe, it, expect } from "vitest";
import { fetchLiveWebhookKeyForAdmin, isPlatformAdmin } from "../../supabase/functions/_shared/isvLiveWebhookKeyFetch";

const A = "11111111-2222-4333-8444-555555555555", B = "99999999-2222-4333-8444-555555555555";
const env = (o: Record<string, string>) => (n: string) => o[n];
const CREDS = env({ VIVA_ISV_LIVE_CLIENT_ID: "fid", VIVA_ISV_LIVE_CLIENT_SECRET: "fsec", VIVA_ISV_CLIENT_ID: "demo", VIVA_ISV_CLIENT_SECRET: "demo" });
const ok = { userId: A, aal: "aal2", confirmed: true };
function viva(calls: string[], key: unknown = "fake-key") {
  return (async (u: string) => {
    calls.push(u);
    if (u.endsWith("/connect/token")) return new Response(JSON.stringify({ access_token: "t" }));
    return new Response(JSON.stringify({ key }));
  }) as any;
}

describe("LIVE ISV webhook key admin fetch", () => {
  it("admin list fail-closed", () => {
    expect(isPlatformAdmin(A, undefined)).toBe(false);
    expect(isPlatformAdmin(A, `${A},bad`)).toBe(false);
    expect(isPlatformAdmin(A, B)).toBe(false);
    expect(isPlatformAdmin(A, `${B}, ${A}`)).toBe(true);
  });
  it("refuses without session, admin, MFA or confirm, with zero calls", async () => {
    const calls: string[] = [];
    expect((await fetchLiveWebhookKeyForAdmin({ ...ok, userId: null }, A, CREDS, viva(calls))).status).toBe(401);
    expect((await fetchLiveWebhookKeyForAdmin(ok, B, CREDS, viva(calls))).status).toBe(403);
    expect((await fetchLiveWebhookKeyForAdmin({ ...ok, aal: "aal1" }, A, CREDS, viva(calls))).body.error).toBe("mfa_required");
    expect((await fetchLiveWebhookKeyForAdmin({ ...ok, confirmed: false }, A, CREDS, viva(calls))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it("demo creds never used", async () => {
    const calls: string[] = [];
    const r = await fetchLiveWebhookKeyForAdmin(ok, A, env({ VIVA_ISV_CLIENT_ID: "d", VIVA_ISV_CLIENT_SECRET: "d" }), viva(calls));
    expect(r.body.error).toBe("live_isv_credentials_missing"); expect(calls).toHaveLength(0);
  });
  it("uses LIVE hosts and returns key", async () => {
    const calls: string[] = [];
    expect(await fetchLiveWebhookKeyForAdmin(ok, A, CREDS, viva(calls))).toEqual({ status: 200, body: { key: "fake-key" } });
    expect(calls).toEqual(["https://accounts.vivapayments.com/connect/token", "https://api.vivapayments.com/isv/v1/webhooks/token"]);
  });
  it("bad provider response fails without leaking", async () => {
    const r = await fetchLiveWebhookKeyForAdmin(ok, A, CREDS, viva([], ""));
    expect(r).toEqual({ status: 502, body: { error: "key_unavailable" } });
  });
});

import { resolveLiveVerificationKey, _resetLiveKeyCache } from "../../supabase/functions/_shared/isvLiveWebhookKeyFetch";
describe("on-demand verification key for viva-webhook GET ?isv=1", () => {
  const ON = { VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_LIVE_CLIENT_ID: "fid", VIVA_ISV_LIVE_CLIENT_SECRET: "fsec" };
  it("switch off -> null, no calls", async () => {
    _resetLiveKeyCache(); const calls: string[] = [];
    expect(await resolveLiveVerificationKey(env({ VIVA_ISV_LIVE_CLIENT_ID: "a", VIVA_ISV_LIVE_CLIENT_SECRET: "b" }), viva(calls))).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("stored key wins without calls", async () => {
    _resetLiveKeyCache(); const calls: string[] = [];
    expect(await resolveLiveVerificationKey(env({ ...ON, VIVA_ISV_LIVE_WEBHOOK_VERIFICATION_KEY: "s" }), viva(calls))).toBe("s");
    expect(calls).toHaveLength(0);
  });
  it("fetches once on demand, then cached and single-flight", async () => {
    _resetLiveKeyCache(); const calls: string[] = [];
    const [a, b] = await Promise.all([resolveLiveVerificationKey(env(ON), viva(calls)), resolveLiveVerificationKey(env(ON), viva(calls))]);
    expect(a).toBe("fake-key"); expect(b).toBe("fake-key");
    expect(await resolveLiveVerificationKey(env(ON), viva(calls))).toBe("fake-key");
    expect(calls).toHaveLength(2);
  });
  it("provider failure -> null and not cached", async () => {
    _resetLiveKeyCache(); const calls: string[] = [];
    expect(await resolveLiveVerificationKey(env(ON), viva(calls, ""))).toBeNull();
    expect(await resolveLiveVerificationKey(env(ON), viva(calls))).toBe("fake-key");
  });
});
