import { describe, it, expect } from "vitest";
import { registerLiveIsvWebhooksForAdmin, ISV_WEBHOOK_URL, CONFIRM_WORD } from "../../supabase/functions/_shared/isvLiveWebhookRegister";

const A = "11111111-2222-4333-8444-555555555555";
const env = (o: Record<string, string>) => (n: string) => o[n];
const ON = env({ VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_LIVE_CLIENT_ID: "fid", VIVA_ISV_LIVE_CLIENT_SECRET: "fsec" });
const ok = { userId: A, aal: "aal2", confirmed: true };
function viva(calls: { u: string; m: string; b?: string }[], listStatus = 405, list: unknown = [], postOk = true) {
  return (async (u: string, i?: RequestInit) => {
    calls.push({ u, m: i?.method ?? "GET", b: i?.body as string });
    if (u.endsWith("/connect/token")) return new Response(JSON.stringify({ access_token: "t" }));
    if ((i?.method ?? "GET") === "GET") return new Response(JSON.stringify(list), { status: listStatus });
    return new Response("{}", { status: postOk ? 200 : 400 });
  }) as any;
}

describe("LIVE ISV webhook registration", () => {
  it("refuses without admin/MFA/confirm/switch, zero calls", async () => {
    const c: any[] = [];
    expect((await registerLiveIsvWebhooksForAdmin({ ...ok, aal: "aal1" }, A, ON, viva(c))).body.error).toBe("mfa_required");
    expect((await registerLiveIsvWebhooksForAdmin(ok, undefined, ON, viva(c))).status).toBe(403);
    expect((await registerLiveIsvWebhooksForAdmin({ ...ok, confirmed: false }, A, ON, viva(c))).status).toBe(400);
    expect((await registerLiveIsvWebhooksForAdmin(ok, A, env({ VIVA_ISV_LIVE_CLIENT_ID: "a", VIVA_ISV_LIVE_CLIENT_SECRET: "b" }), viva(c))).body.error).toBe("live_isv_disabled");
    expect(c).toHaveLength(0);
  });
  it("registers both with fixed body on LIVE host", async () => {
    const c: any[] = [];
    const r = await registerLiveIsvWebhooksForAdmin(ok, A, ON, viva(c));
    expect(r).toEqual({ status: 200, body: { list: "unsupported", events: { 8193: "registered", 8194: "registered" } } });
    const posts = c.filter((x) => x.m === "POST" && x.u.endsWith("/isv/v1/webhooks"));
    expect(posts.map((p) => JSON.parse(p.b))).toEqual([{ url: ISV_WEBHOOK_URL, eventTypeId: 8193 }, { url: ISV_WEBHOOK_URL, eventTypeId: 8194 }]);
    expect(posts[0].u).toBe("https://api.vivapayments.com/isv/v1/webhooks");
    expect(JSON.stringify(r)).not.toMatch(/fid|fsec|"t"/);
  });
  it("skips already registered when list works", async () => {
    const c: any[] = [];
    const r = await registerLiveIsvWebhooksForAdmin(ok, A, ON, viva(c, 200, [{ url: ISV_WEBHOOK_URL, eventTypeId: 8193 }]));
    expect(r.body.events).toEqual({ 8193: "already_registered", 8194: "registered" });
  });
  it("unclear list error stops before any POST", async () => {
    const c: any[] = [];
    expect((await registerLiveIsvWebhooksForAdmin(ok, A, ON, viva(c, 500))).body.error).toBe("list_failed");
    expect(c.some((x) => x.m === "POST" && x.u.includes("/isv/v1/webhooks"))).toBe(false);
  });
  it("first POST failure stops, no retry", async () => {
    const c: any[] = [];
    const r = await registerLiveIsvWebhooksForAdmin(ok, A, ON, viva(c, 405, [], false));
    expect(r.status).toBe(502); expect(r.body.events).toEqual({ 8193: "failed" });
  });
  it("confirm word is fixed", () => expect(CONFIRM_WORD).toBe("register_live_isv_webhooks_8193_8194"));
});
