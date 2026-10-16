import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isLivePilotUserAllowed, liveWebhookVerificationKey } from "../../supabase/functions/_shared/inactive/isvLiveConfig";
import { liveCreateForSession } from "../../supabase/functions/_shared/inactive/isvLiveCreate";

const U = "11111111-2222-4333-8444-555555555555", O = "99999999-2222-4333-8444-555555555555";
const g = (e: Record<string, string>) => (n: string) => e[n];

describe("LIVE pilot allowlist", () => {
  it("absent/empty/invalid/nonmatching deny; exact match allows", () => {
    expect(isLivePilotUserAllowed(U, g({}))).toBe(false);
    expect(isLivePilotUserAllowed(U, g({ VIVA_ISV_LIVE_PILOT_USER_IDS: " " }))).toBe(false);
    expect(isLivePilotUserAllowed(U, g({ VIVA_ISV_LIVE_PILOT_USER_IDS: `${U},nope` }))).toBe(false);
    expect(isLivePilotUserAllowed(U, g({ VIVA_ISV_LIVE_PILOT_USER_IDS: O }))).toBe(false);
    expect(isLivePilotUserAllowed(U, g({ VIVA_ISV_LIVE_PILOT_USER_IDS: `${O}, ${U}` }))).toBe(true);
  });
  it("create: global switch first, then pilot before any read/call", async () => {
    let reads = 0; const calls: string[] = [];
    const base = { VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_LIVE_CLIENT_ID: "x", VIVA_ISV_LIVE_CLIENT_SECRET: "y" };
    const deps = (env: any) => ({ get: g(env), fetchFn: (async (u: string) => { calls.push(u); return new Response("{}"); }) as any,
      store: {} as any, newAttemptId: () => "a", findLiveRow: async () => { reads++; return "error" as const; }, persist: async () => true });
    expect((await liveCreateForSession(U, "a@b.nl", deps({ VIVA_ISV_LIVE_PILOT_USER_IDS: U }))).body).toEqual({ error: "live_isv_disabled" });
    expect((await liveCreateForSession(U, "a@b.nl", deps({ ...base, VIVA_ISV_LIVE_PILOT_USER_IDS: O }))).body).toEqual({ error: "pilot_not_enabled" });
    expect(reads + calls.length).toBe(0);
    expect((await liveCreateForSession(U, "a@b.nl", deps({ ...base, VIVA_ISV_LIVE_PILOT_USER_IDS: U }))).body).toEqual({ error: "unavailable" });
    expect(reads).toBe(1); expect(calls.length).toBe(0);
  });
  it("webhook verification key only with switch and key; GET marker wired", () => {
    expect(liveWebhookVerificationKey(g({ VIVA_ISV_LIVE_WEBHOOK_VERIFICATION_KEY: "k" }))).toBeNull();
    expect(liveWebhookVerificationKey(g({ VIVA_ISV_LIVE_ENABLED: "true" }))).toBeNull();
    expect(liveWebhookVerificationKey(g({ VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_LIVE_WEBHOOK_VERIFICATION_KEY: "k" }))).toBe("k");
    const src = readFileSync("supabase/functions/viva-webhook/index.ts", "utf8");
    const i = src.indexOf('searchParams.get("isv") === "1"');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(src.indexOf('["OPTIONS", "GET", "HEAD"].includes(method)'));
  });
});
