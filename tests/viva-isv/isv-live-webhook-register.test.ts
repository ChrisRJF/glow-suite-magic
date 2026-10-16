import { describe, it, expect } from "vitest";
import { registerLiveIsvWebhooksForAdmin, ISV_EVENT_TYPES, ISV_WEBHOOK_URL, CONFIRM_WORD } from "../../supabase/functions/_shared/isvLiveWebhookRegister";
const A = "11111111-2222-4333-8444-555555555555";
const env = (o: Record<string, string>) => (n: string) => o[n];
const ON = env({ VIVA_ISV_LIVE_ENABLED: "true", VIVA_ISV_LIVE_CLIENT_ID: "fid", VIVA_ISV_LIVE_CLIENT_SECRET: "fsec" });
const ok = { userId: A, aal: "aal2", confirmed: true };
function fixture(status = 204, callbackKey = "key", throws = false) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/connect/token")) return Response.json({ access_token: "test-token" });
    if (url.endsWith("/webhooks/token")) return Response.json({ key: "key" });
    if (url === ISV_WEBHOOK_URL) return Response.json({ key: callbackKey });
    if (throws) throw new Error("sensitive-provider-text");
    return new Response(status === 204 ? null : "sensitive-provider-text", { status });
  };
  return { calls, fetch };
}
describe("LIVE ISV five-event registration", () => {
  it.each([
    [{ ...ok, userId: null }, A, ON, 401],
    [ok, undefined, ON, 403],
    [{ ...ok, aal: "aal1" }, A, ON, 403],
    [{ ...ok, confirmed: false }, A, ON, 400],
    [ok, A, env({}), 503],
  ] as const)("rejects unauthorized configuration before provider access %#", async (auth, ids, get, status) => {
    const f = fixture();
    expect((await registerLiveIsvWebhooksForAdmin(auth, ids, get, f.fetch)).status).toBe(status);
    expect(f.calls).toHaveLength(0);
  });
  it("registers exactly five fixed events only after matching callback key, 204 required", async () => {
    const f = fixture(); const r = await registerLiveIsvWebhooksForAdmin(ok, A, ON, f.fetch);
    expect(ISV_EVENT_TYPES).toEqual([1796,1797,1798,8193,8194]);
    expect(CONFIRM_WORD).toBe("register_live_isv_webhooks_1796_1797_1798_8193_8194");
    const posts = f.calls.filter(c => c.url.endsWith("/isv/v1/webhooks"));
    expect(posts.map(c => JSON.parse(String(c.init?.body)))).toEqual(ISV_EVENT_TYPES.map(eventTypeId => ({ url: ISV_WEBHOOK_URL, eventTypeId })));
    expect(posts.every(c => c.init?.method === "POST")).toBe(true);
    expect(f.calls[2].url).toBe(ISV_WEBHOOK_URL);
    expect(Object.values(r.body.events ?? {}).map(e => [e.status,e.httpStatus])).toEqual(ISV_EVENT_TYPES.map(() => ["registered",204]));
    expect(JSON.stringify(r)).not.toContain("test-token");
  });
  it("mismatched verification challenge sends no registration", async () => {
    const f = fixture(204,"wrong");
    expect((await registerLiveIsvWebhooksForAdmin(ok,A,ON,f.fetch)).body.error).toBe("callback_verification_failed");
    expect(f.calls).toHaveLength(3);
  });
  it.each([200,400,409,500])("HTTP %s never proves already registered", async status => {
    const f = fixture(status);const r = await registerLiveIsvWebhooksForAdmin(ok,A,ON,f.fetch);
    expect(Object.values(r.body.events ?? {}).map(e => [e.status,e.httpStatus])).toEqual(ISV_EVENT_TYPES.map(() => ["failed",status]));
    expect(JSON.stringify(r)).not.toContain("sensitive-provider-text");
    expect(f.calls).toHaveLength(8);
  });
  it("uncertain outcomes are not retried or claimed successful", async () => {
    const f = fixture(204,"key",true);const r = await registerLiveIsvWebhooksForAdmin(ok,A,ON,f.fetch);
    expect(Object.values(r.body.events ?? {}).map(e => [e.status,e.httpStatus])).toEqual(ISV_EVENT_TYPES.map(() => ["unknown",null]));
    expect(f.calls).toHaveLength(8);
    expect(JSON.stringify(r)).not.toContain("sensitive-provider-text");
  });
});
