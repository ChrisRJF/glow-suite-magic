// Send Security 1.0: full future request path (HTTP -> auth -> guard -> adapters -> mocked DB/provider).
// Fictitious data only. No network: fetch is a mock.
import { describe, it, expect, vi } from "vitest";
import { handleWhatsAppSendHttp } from "../../supabase/functions/_shared/inactive/whatsappSendHttp";
import { buildDeps, type Db } from "../../supabase/functions/_shared/inactive/whatsappSendAdapters";
import { signServiceRequest } from "../../supabase/functions/_shared/inactive/whatsappSendSigner";

const SA = "11111111-1111-1111-1111-111111111111", SB = "22222222-2222-2222-2222-222222222222";
const STAFF = "33333333-3333-3333-3333-333333333333";
const CA = "c0000000-0000-0000-0000-0000000000a1", CB = "c0000000-0000-0000-0000-0000000000b1";
const REB = "e0000000-0000-0000-0000-000000000002";
const GW_A = "99999999-0000-0000-0000-00000000000a";
const NOW = 1_800_000_000_000;
const b64 = (n: number) => Buffer.from(new Uint8Array(32).fill(n)).toString("base64");
const SVC_KEY = new Uint8Array(32).fill(7);
const URL_ = "https://x.functions.supabase.co/whatsapp-send";
const TOKENS: Record<string, string> = { ["t".repeat(30) + "owner"]: SA, ["t".repeat(30) + "staff"]: STAFF };
const OWNER = "Bearer " + "t".repeat(30) + "owner", STAFFT = "Bearer " + "t".repeat(30) + "staff";

function world(o: { paused?: boolean; stopped?: boolean; optIn?: boolean | null; demo?: boolean; finalizeFails?: boolean; enabled?: boolean } = {}) {
  const tables: Record<string, Record<string, unknown>[]> = {
    user_roles: [{ user_id: SA, role: "eigenaar" }, { user_id: SB, role: "eigenaar" }],
    user_access: [{ owner_user_id: SA, member_user_id: STAFF, role: "medewerker", status: "active" }],
    customers: [
      { id: CA, user_id: SA, phone: "+31612345678", whatsapp_opt_in: o.optIn === undefined ? true : o.optIn, marketing_consent: true, archived_at: null, pseudonymized_at: null, communication_blocked_at: null },
      { id: CB, user_id: SB, phone: "+31687654321", whatsapp_opt_in: true, marketing_consent: true, archived_at: null, pseudonymized_at: null, communication_blocked_at: null },
    ],
    appointments: [], customer_message_preferences: [],
    settings: [{ user_id: SA, is_demo: !!o.demo, demo_mode: false }, { user_id: SB, is_demo: false, demo_mode: false }],
    whatsapp_settings: [{ user_id: SA, enabled: o.enabled ?? true }, { user_id: SB, enabled: true }],
    tenant_feature_flags: [{ tenant_id: SA, whatsapp_sending_paused: o.paused ?? false }, { tenant_id: SB, whatsapp_sending_paused: false }],
    gateway_tenant_links: [{ tenant_id: GW_A, salon_id: SA, enabled: true, allowed_action_types: ["opt_out_signal"] }],
    rebook_actions: [{ id: REB, user_id: SA, customer_id: CA, appointment_id: null, reversed_at: null }],
  };
  const claims = new Map<string, { fp: string; state: string }>();
  const nonces = new Set<string>();
  const db: Db = {
    async select(t, _c, eq, opts) {
      const rows = (tables[t] ?? []).filter((r) => Object.entries(eq).every(([k, v]) => r[k] === v));
      return { data: rows.slice(0, opts?.limit ?? 2), error: null };
    },
    async rpc(fn, a) {
      if (fn === "whatsapp_is_opted_out") return { data: !!o.stopped, error: null };
      if (fn === "wa_remember_nonce") { const k = `${a._caller}|${a._nonce}`; if (nonces.has(k)) return { data: false, error: null }; nonces.add(k); return { data: true, error: null }; }
      if (fn === "wa_claim_send") {
        const k = `${a._tenant}|${a._key}`, c = claims.get(k);
        if (!c) { claims.set(k, { fp: a._fp as string, state: "claimed" }); return { data: { result: "created" }, error: null }; }
        return { data: c.fp === a._fp ? { result: "exists", state: c.state } : { result: "conflict" }, error: null };
      }
      if (fn === "wa_finalize_send") {
        if (o.finalizeFails) return { data: null, error: { message: "down" } };
        const c = claims.get(`${a._tenant}|${a._key}`); if (!c || c.state !== "claimed") return { data: false, error: null };
        c.state = a._state as string; return { data: true, error: null };
      }
      return { data: null, error: { code: "42883" } };
    },
  };
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sid: "SM123", status: "queued" }), { status: 201 }));
  const env = {
    WA_CLAIM_HMAC_KEY: b64(1), WA_CONTACT_REF_KEYS: JSON.stringify({ current: "1", keys: { "1": b64(2) } }),
    WA_SEND_SERVICE_KEYS: JSON.stringify({ "auto-rebook": { current: "1", keys: { "1": Buffer.from(SVC_KEY).toString("base64") } } }),
    LOVABLE_API_KEY: "lk", TWILIO_API_KEY: "tk", WA_FROM_NUMBER: "whatsapp:+31201234567",
  };
  const http = {
    build: () => buildDeps(db, env, { fetch: fetchMock as unknown as typeof fetch, now: () => NOW }),
    verifyJwt: async (t: string) => (TOKENS[t] ? { sub: TOKENS[t] } : null),
  };
  const send = (body: unknown, headers: Record<string, string> = {}, method = "POST") =>
    handleWhatsAppSendHttp(new Request(URL_, { method, headers, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined }), http);
  return { send, fetchMock, claims };
}
const manual = (o: Record<string, unknown> = {}) => ({ customer_id: CA, message: "Hoi", kind: "manual", action_id: crypto.randomUUID(), ...o });
const res = async (r: Response) => ({ status: r.status, body: await r.json() });
const svcBody = JSON.stringify({ customer_id: CA, message: "Plek vrij", kind: "auto_rebook", event_ref: `rebook_action:${REB}` });

describe("whatsapp-send 1.0: full request path", () => {
  it("rejects unsupported methods and anonymous requests", async () => {
    const w = world();
    expect((await w.send(null, {}, "GET")).status).toBe(405);
    expect((await res(await w.send(manual()))).status).toBe(401);
    expect((await res(await w.send(manual(), { authorization: "Bearer " + "x".repeat(40) }))).status).toBe(401);
    expect(w.fetchMock).not.toHaveBeenCalled();
  });
  it("refuses a forged user_id", async () => {
    const w = world(); const r = await res(await w.send(manual({ user_id: SB }), { authorization: OWNER }));
    expect(r).toMatchObject({ status: 403, body: { error: "body_tenant_mismatch" } });
  });
  it("refuses cross-tenant sends", async () => {
    const w = world(); const r = await res(await w.send(manual({ customer_id: CB }), { authorization: OWNER }));
    expect(r).toMatchObject({ status: 403, body: { error: "customer_not_in_tenant" } }); expect(w.fetchMock).not.toHaveBeenCalled();
  });
  it("refuses an invalid service signature and a body-only caller claim", async () => {
    const w = world();
    const h = await signServiceRequest("auto-rebook", "1", new Uint8Array(32).fill(8), svcBody, NOW);
    expect((await w.send(svcBody, h)).status).toBe(401);
    const good = await signServiceRequest("auto-rebook", "1", SVC_KEY, svcBody, NOW);
    expect((await w.send(svcBody.replace("Plek", "Plaats"), good)).status).toBe(401); // body differs from signed bytes
    expect((await w.send(JSON.stringify({ ...JSON.parse(svcBody), caller: "auto-rebook" }), { authorization: "Bearer " + "s".repeat(40) })).status).toBe(401);
    expect(w.fetchMock).not.toHaveBeenCalled();
  });
  it("refuses a nonce replay", async () => {
    const w = world(); const h = await signServiceRequest("auto-rebook", "1", SVC_KEY, svcBody, NOW);
    expect((await w.send(svcBody, h)).status).toBe(200);
    expect(await res(await w.send(svcBody, h))).toMatchObject({ status: 401, body: { error: "replay" } });
    expect(w.fetchMock).toHaveBeenCalledTimes(1);
  });
  it("emergency stop blocks (also with test=true)", async () => {
    const w = world({ paused: true });
    expect(await res(await w.send(manual(), { authorization: OWNER }))).toMatchObject({ status: 503, body: { error: "sending_paused" } });
    expect((await w.send(manual({ kind: "test", test: true }), { authorization: OWNER })).status).toBe(503);
    expect(w.claims.size).toBe(0); expect(w.fetchMock).not.toHaveBeenCalled();
  });
  it("STOP blocks", async () => {
    const w = world({ stopped: true });
    expect(await res(await w.send(manual(), { authorization: OWNER }))).toMatchObject({ status: 409, body: { error: "customer_stopped" } });
    expect(w.fetchMock).not.toHaveBeenCalled();
  });
  it("missing consent blocks", async () => {
    const w = world({ optIn: null });
    expect(await res(await w.send(manual(), { authorization: OWNER }))).toMatchObject({ status: 409, body: { error: "consent_unknown" } });
  });
  it("test mode cannot bypass role, WhatsApp setting or recipient checks", async () => {
    const w = world();
    expect((await w.send(manual({ kind: "test", test: true }), { authorization: STAFFT })).status).toBe(403);
    expect((await w.send(manual({ kind: "test", test: true, to: "+31600000000" }), { authorization: OWNER })).status).toBe(422);
    const off = world({ enabled: false });
    expect(await res(await off.send(manual({ kind: "test", test: true }), { authorization: OWNER }))).toMatchObject({ status: 409, body: { error: "whatsapp_disabled" } });
    expect(w.fetchMock).not.toHaveBeenCalled(); expect(off.fetchMock).not.toHaveBeenCalled();
  });
  it("two identical concurrent requests cause at most one provider call", async () => {
    const w = world(); const b = manual();
    const rs = await Promise.all([w.send(b, { authorization: OWNER }), w.send(b, { authorization: OWNER })]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]); expect(w.fetchMock).toHaveBeenCalledTimes(1);
  });
  it("failure after provider acceptance never resends", async () => {
    const w = world({ finalizeFails: true }); const b = manual();
    expect((await w.send(b, { authorization: OWNER })).status).toBe(200);
    expect(await res(await w.send(b, { authorization: OWNER }))).toMatchObject({ status: 409, body: { error: "outcome_unknown" } });
    expect(w.fetchMock).toHaveBeenCalledTimes(1);
  });
  it("authorized user and signed service requests reach the mocked provider; no raw errors leak", async () => {
    const w = world();
    expect(await res(await w.send(manual(), { authorization: OWNER }))).toMatchObject({ status: 200, body: { success: true, status: "sent" } });
    const h = await signServiceRequest("auto-rebook", "1", SVC_KEY, svcBody, NOW);
    expect((await w.send(svcBody, h)).status).toBe(200);
    expect(w.fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = w.fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain("To=whatsapp%3A%2B31612345678");
    w.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 21608, message: "secret raw text" }), { status: 400 }));
    const r = await res(await w.send(manual(), { authorization: OWNER }));
    expect(r.status).toBe(502); expect(JSON.stringify(r.body)).not.toContain("secret raw text");
  });
  it("demo simulates without provider contact", async () => {
    const w = world({ demo: true });
    expect(await res(await w.send(manual(), { authorization: OWNER }))).toMatchObject({ status: 200, body: { status: "simulated" } });
    expect(w.fetchMock).not.toHaveBeenCalled();
  });
  it("missing configuration or sandbox sender fails closed with 503", async () => {
    const http = { build: () => null, verifyJwt: async () => ({ sub: SA }) };
    const r = await handleWhatsAppSendHttp(new Request(URL_, { method: "POST", body: "{}" }), http);
    expect(r.status).toBe(503);
    expect(buildDeps({} as Db, { WA_CLAIM_HMAC_KEY: b64(1), WA_CONTACT_REF_KEYS: "x", LOVABLE_API_KEY: "a", TWILIO_API_KEY: "b", WA_FROM_NUMBER: "whatsapp:+14155238886" }, { fetch, now: Date.now })).toBeNull();
  });
});
