// Send Security 1.0: full future request path (HTTP -> auth -> guard -> adapters -> mocked DB/provider).
// Fictitious data only. No network: fetch is a mock.
import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
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

type TplRow = Record<string, unknown>;
const TPL_OK: TplRow = { name: "glow_manual", language: "nl", status: "APPROVED", category: "MARKETING", components: [{ type: "BODY", text: "Hoi {{1}}, {{2}}" }] };
const TPL_REB: TplRow = { name: "glow_rebook", language: "nl", status: "APPROVED", category: "MARKETING", components: [{ type: "BODY", text: "Er is een plek vrij op {{1}}" }] };
const TEMPLATES = { manual: { name: "glow_manual", language: "nl", category: "MARKETING", params: 2 }, test: { name: "glow_manual", language: "nl", category: "MARKETING", params: 2 }, auto_rebook: { name: "glow_rebook", language: "nl", category: "MARKETING", params: 1 } };
const PHONE_ID = "100000000000001";
function world(o: { paused?: boolean; stopped?: boolean; optIn?: boolean | null; demo?: boolean; finalizeFails?: boolean; enabled?: boolean; tpl?: TplRow[]; env?: Record<string, string | null> } = {}) {
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
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.includes("/message_templates")
    ? new Response(JSON.stringify({ data: o.tpl ?? [TPL_OK, TPL_REB] }), { status: 200 })
    : new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: "wamid.HBgM123" }] }), { status: 200 }));
  const env = {
    WA_CLAIM_HMAC_KEY: b64(1), WA_CONTACT_REF_KEYS: JSON.stringify({ current: "1", keys: { "1": b64(2) } }),
    WA_SEND_SERVICE_KEYS: JSON.stringify({ "auto-rebook": { current: "1", keys: { "1": Buffer.from(SVC_KEY).toString("base64") } } }),
    LOVABLE_API_KEY: "lk", WHATSAPP_API_KEY: "wk", WA_META_PHONE_NUMBER_ID: PHONE_ID,
    WA_META_SENDERS: JSON.stringify({ [SA]: PHONE_ID, [SB]: PHONE_ID }), WA_META_TEMPLATES: JSON.stringify(TEMPLATES),
    ...(o.env ?? {}),
  };
  const http = {
    build: () => buildDeps(db, env, { fetch: fetchMock as unknown as typeof fetch, now: () => NOW }),
    verifyJwt: async (t: string) => (TOKENS[t] ? { sub: TOKENS[t] } : null),
  };
  const send = (body: unknown, headers: Record<string, string> = {}, method = "POST") =>
    handleWhatsAppSendHttp(new Request(URL_, { method, headers, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined }), http);
  const sends = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/messages"));
  return { send, fetchMock, claims, sends, env, db };
}
const manual = (o: Record<string, unknown> = {}) => ({ customer_id: CA, message: "Hoi", kind: "manual", template_params: ["Anna", "tot snel"], action_id: crypto.randomUUID(), ...o });
const res = async (r: Response) => ({ status: r.status, body: await r.json() });
const svcBody = JSON.stringify({ customer_id: CA, message: "Plek vrij", kind: "auto_rebook", template_params: ["vrijdag"], event_ref: `rebook_action:${REB}` });

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
    expect(w.sends()).toHaveLength(1);
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
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]); expect(w.sends()).toHaveLength(1);
  });
  it("failure after provider acceptance never resends", async () => {
    const w = world({ finalizeFails: true }); const b = manual();
    expect((await w.send(b, { authorization: OWNER })).status).toBe(200);
    expect(await res(await w.send(b, { authorization: OWNER }))).toMatchObject({ status: 409, body: { error: "outcome_unknown" } });
    expect(w.sends()).toHaveLength(1);
  });
  it("authorized user and signed service requests reach the mocked provider; no raw errors leak", async () => {
    const w = world();
    expect(await res(await w.send(manual(), { authorization: OWNER }))).toMatchObject({ status: 200, body: { success: true, status: "sent" } });
    const h = await signServiceRequest("auto-rebook", "1", SVC_KEY, svcBody, NOW);
    expect((await w.send(svcBody, h)).status).toBe(200);
    expect(w.sends()).toHaveLength(2);
    const [url, init] = w.sends()[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://connector-gateway.lovable.dev/whatsapp/messages");
    expect(JSON.parse(String(init.body))).toEqual({ messaging_product: "whatsapp", to: "31612345678", type: "template",
      template: { name: "glow_manual", language: { code: "nl" }, components: [{ type: "body", parameters: [{ type: "text", text: "Anna" }, { type: "text", text: "tot snel" }] }] } });
    expect((init.headers as Record<string, string>)["X-Connection-Api-Key"]).toBe("wk");
    w.fetchMock.mockImplementation(async (u: string) => u.includes("/message_templates")
      ? new Response(JSON.stringify({ data: [TPL_OK] }), { status: 200 })
      : new Response(JSON.stringify({ error: { code: 131026, message: "secret raw text" } }), { status: 400 }));
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
    expect(buildDeps({} as Db, { WA_CLAIM_HMAC_KEY: b64(1), WA_CONTACT_REF_KEYS: "x", LOVABLE_API_KEY: "a" }, { fetch, now: Date.now })).toBeNull();
  });
});

describe("whatsapp-send 1.0: Meta Cloud API adapter (mocked gateway)", () => {
  const owner = { authorization: OWNER };
  it("valid template send returns the wamid", async () => {
    const w = world(); const r = await res(await w.send(manual(), owner));
    expect(r).toMatchObject({ status: 200, body: { success: true, sid: "wamid.HBgM123" } });
  });
  it("no provider contact without consent or with STOP", async () => {
    for (const o of [{ optIn: false }, { optIn: null }, { stopped: true }]) {
      const w = world(o); expect((await w.send(manual(), owner)).status).toBe(409); expect(w.fetchMock).not.toHaveBeenCalled();
    }
  });
  it("missing access key / phone id / invalid or cross-wired sender config fails closed", () => {
    const base = world().env; const io = { fetch, now: Date.now };
    for (const patch of [{ WHATSAPP_API_KEY: null }, { LOVABLE_API_KEY: null }, { WA_META_PHONE_NUMBER_ID: "abc" }, { WA_META_SENDERS: null },
      { WA_META_SENDERS: "{bad" }, { WA_META_SENDERS: JSON.stringify({ [SA]: "200000000000002" }) }, { WA_META_TEMPLATES: JSON.stringify({ manual: { name: "X Y", language: "nl", category: "MARKETING", params: 0 } }) }])
      expect(buildDeps({} as Db, { ...base, ...patch }, io)).toBeNull();
  });
  it("salon without a verified sender is refused before any claim or call", async () => {
    const w = world({ env: { WA_META_SENDERS: JSON.stringify({ [SB]: PHONE_ID }) } });
    expect(await res(await w.send(manual(), owner))).toMatchObject({ status: 503, body: { error: "sender_not_configured" } });
    expect(w.fetchMock).not.toHaveBeenCalled(); expect(w.claims.size).toBe(0);
  });
  it("cross-tenant customer is refused before sender lookup", async () => {
    const w = world(); expect((await w.send(manual({ customer_id: CB }), owner)).status).toBe(403); expect(w.fetchMock).not.toHaveBeenCalled();
  });
  it("invalid / unapproved / wrong-language / wrong-format templates are never sent and burn no claim", async () => {
    const cases: Array<[TplRow[], string]> = [
      [[], "template_not_found"],
      [[{ ...TPL_OK, status: "PENDING" }], "template_not_approved"],
      [[{ ...TPL_OK, language: "en_US" }], "template_not_found"],
      [[{ ...TPL_OK, category: "UTILITY" }], "template_category_mismatch"],
      [[{ ...TPL_OK, components: [{ type: "BODY", text: "Hoi {{1}}" }] }], "template_format_mismatch"],
      [[{ ...TPL_OK, components: [{ type: "HEADER", text: "{{1}}" }, { type: "BODY", text: "{{1}} {{2}}" }] }], "template_format_mismatch"],
    ];
    for (const [tpl, reason] of cases) {
      const w = world({ tpl }); expect(await res(await w.send(manual(), owner))).toMatchObject({ status: 422, body: { error: reason } });
      expect(w.sends()).toHaveLength(0); expect(w.claims.size).toBe(0);
    }
    const w = world();
    expect(await res(await w.send(manual({ template_params: ["Anna"] }), owner))).toMatchObject({ status: 422, body: { error: "template_params_mismatch" } });
    expect((await w.send(manual({ template_params: ["a\nb", "c"] }), owner)).status).toBe(400);
    const bad = world({ env: { WA_META_TEMPLATES: JSON.stringify({ manual: { ...TEMPLATES.manual, category: "UTILITY" } }) } });
    expect(await res(await bad.send(manual(), owner))).toMatchObject({ status: 422, body: { error: "template_category_mismatch" } });
    expect(w.sends()).toHaveLength(0); expect(bad.fetchMock).not.toHaveBeenCalled();
  });
  it("free text without a template is refused; a client 'window open' claim is ignored", async () => {
    const w = world({ env: { WA_META_TEMPLATES: "{}" } });
    expect(await res(await w.send(manual({ template_params: [], service_window_open: true }), owner))).toMatchObject({ status: 422, body: { error: "free_text_window_unverified" } });
    expect(w.fetchMock).not.toHaveBeenCalled();
  });
  it("template lookup failure fails closed without a claim", async () => {
    const w = world(); w.fetchMock.mockImplementation(async () => new Response("x", { status: 503 }));
    expect(await res(await w.send(manual(), owner))).toMatchObject({ status: 503, body: { error: "template_lookup_failed" } });
    expect(w.claims.size).toBe(0);
  });
  it("Meta error is a safe 502; 5xx, timeout and id-less 2xx are 'unknown' and never resent", async () => {
    const replies = [
      () => new Response(JSON.stringify({ error: { code: 131047, message: "raw meta" } }), { status: 400 }),
      () => new Response("gateway down", { status: 502 }),
      () => new Response(JSON.stringify({ messages: [] }), { status: 200 }),
      () => { throw new DOMException("aborted", "AbortError"); },
    ];
    for (const [i, reply] of replies.entries()) {
      const w = world(); w.fetchMock.mockImplementation(async (u: string) => u.includes("/message_templates")
        ? new Response(JSON.stringify({ data: [TPL_OK] }), { status: 200 }) : reply());
      const b = manual(); const r = await res(await w.send(b, owner));
      expect(r.status).toBe(502); expect(JSON.stringify(r.body)).not.toContain("raw meta");
      expect(r.body.error).toBe(i === 0 ? "provider_rejected" : "outcome_unknown");
      const again = await res(await w.send(b, owner));
      expect(again.body.error).toBe(i === 0 ? "previous_attempt_failed_needs_new_action" : "outcome_unknown");
      expect(w.sends()).toHaveLength(1);
    }
  });
  it("demo tenant never calls Meta (no template lookup either)", async () => {
    const w = world({ demo: true }); expect((await w.send(manual(), owner)).status).toBe(200); expect(w.fetchMock).not.toHaveBeenCalled();
  });
  it("new route has no Twilio dependency and import paths resolve from the future location", () => {
    const root = resolve(__dirname, "../..");
    const files = ["docs/prepared-patches/whatsapp-send/index.ts", ...["whatsappSendHttp", "whatsappSendAdapters", "whatsappSendGuard"].map((f) => `supabase/functions/_shared/inactive/${f}.ts`)];
    for (const f of files) expect(readFileSync(resolve(root, f), "utf8")).not.toMatch(/twilio|Messages\.json|14155238886/i);
    const patch = readFileSync(resolve(root, "docs/prepared-patches/whatsapp-send/index.ts"), "utf8");
    const target = dirname(resolve(root, "supabase/functions/whatsapp-send/index.ts"));
    const rel = [...patch.matchAll(/from "(\.[^"]+)"/g)].map((m) => m[1]);
    expect(rel.length).toBe(2);
    const seen = new Set<string>(); const queue = rel.map((p) => resolve(target, p));
    while (queue.length) { // every transitive relative import must exist next to the future entrypoint
      const f = queue.shift()!; if (seen.has(f)) continue; seen.add(f);
      expect(existsSync(f), f).toBe(true);
      for (const m of readFileSync(f, "utf8").matchAll(/from "(\.[^"]+)"/g)) queue.push(resolve(dirname(f), m[1]));
    }
  });
});
