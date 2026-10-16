import { describe, it, expect } from "vitest";
import { registerLiveIsvWebhooksForAdmin, ISV_EVENT_TYPES, CONFIRM_WORD } from "../../supabase/functions/_shared/isvLiveWebhookRegister";

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
  it("prepares all five vendor-confirmed event types", () => {
    expect(ISV_EVENT_TYPES).toEqual([1796, 1797, 1798, 8193, 8194]);
  });
  it.each([200, 404, 405, 500])("no internal evidence means zero provider calls, regardless of hypothetical listing status %s", async (status) => {
    const c: any[] = [];
    expect(await registerLiveIsvWebhooksForAdmin(ok, A, ON, viva(c, status))).toEqual({ status: 409, body: { error: "registration_evidence_required" } });
    expect(c).toHaveLength(0);
  });
  it("repeated admin requests cannot register duplicates", async () => {
    const c: any[] = [];
    await Promise.all([1, 2].map(() => registerLiveIsvWebhooksForAdmin(ok, A, ON, viva(c))));
    expect(c).toHaveLength(0);
  });
  it("confirm word is fixed", () => expect(CONFIRM_WORD).toBe("register_live_isv_webhooks_8193_8194"));
});
