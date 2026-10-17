import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { authorizeSendRequest, isServiceBearer, retryAppointmentVerdict } from "../../docs/prepared-patches/whatsapp-security/security";
import { authorizeSchedulerProposal } from "../../docs/prepared-patches/whatsapp-security/schedulerAuth.proposal";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const KEY = "fictional-service-credential-only-for-tests";
const base = { user_id: A, to: "+31600000000", message: "Fictief", customer_id: "c", appointment_id: "a" };
function db(opts: any = {}) {
  const tables: any = { user_roles: [{ role: "eigenaar" }], user_access: [], customers: [{ id: "c", user_id: A, phone: "+31600000000" }], appointments: [{ id: "a", user_id: A, customer_id: "c" }], ...opts.tables };
  const calls: string[] = [];
  const admin = { auth: { getUser: vi.fn(async () => ({ data: { user: opts.invalid ? null : { id: opts.uid || A } }, error: null })) }, from(t: string) {
    calls.push(t);
    const filters: any = {};
    const result = () => ({ data: (tables[t] || []).filter((r: any) => Object.entries(filters).every(([k, v]) => !(k in r) || r[k] === v)), error: opts.lookupError ? { message: "unavailable" } : null });
    const q: any = { select: () => q, eq: (k: string, v: any) => { filters[k] = v; return q; }, then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject), maybeSingle: async () => { const r = result(); return { ...r, data: r.data[0] || null }; } };
    return q;
  }};
  return { admin, calls };
}
const req = (token?: string) => new Request("http://localhost/whatsapp-send", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe("prepared WhatsApp authentication and tenant binding", () => {
  it("anonymous denied before tenant reads", async () => { const d = db(); expect(await authorizeSendRequest(req(), base, d.admin, KEY)).toMatchObject({ allow: false, status: 401 }); expect(d.calls).toEqual([]); });
  it("invalid JWT denied", async () => { expect(await authorizeSendRequest(req("invalid"), base, db({ invalid: true }).admin, KEY)).toMatchObject({ allow: false, status: 401 }); });
  it("forged salon denied", async () => { expect(await authorizeSendRequest(req("user"), { ...base, user_id: B }, db().admin, KEY)).toMatchObject({ allow: false, status: 403 }); });
  it("owner tenant derived when omitted", async () => { const body: any = { ...base }; delete body.user_id; expect(await authorizeSendRequest(req("user"), body, db().admin, KEY)).toMatchObject({ allow: true, tenantId: A }); });
  it("real internal bearer accepted with scoped rows", async () => { const d = db(); expect(await authorizeSendRequest(req(KEY), base, d.admin, KEY)).toMatchObject({ allow: true, via: "service" }); expect(d.admin.auth.getUser).not.toHaveBeenCalled(); });
  it("role string in forged token is not service identity", async () => { expect(await authorizeSendRequest(req("service_role"), base, db({ invalid: true }).admin, KEY)).toMatchObject({ allow: false, status: 401 }); });
  it("cross-salon customer denied also for service", async () => { expect(await authorizeSendRequest(req(KEY), base, db({ tables: { customers: [{ id: "c", user_id: B, phone: base.to }] } }).admin, KEY)).toMatchObject({ allow: false, status: 403 }); });
  it("recipient substitution denied", async () => { expect(await authorizeSendRequest(req(KEY), { ...base, to: "+31699999999" }, db().admin, KEY)).toMatchObject({ allow: false, status: 403 }); });
  it("cross-salon appointment denied", async () => { expect(await authorizeSendRequest(req(KEY), base, db({ tables: { appointments: [{ id: "a", user_id: B, customer_id: "c" }] } }).admin, KEY)).toMatchObject({ allow: false, status: 403 }); });
  it("appointment for another customer denied", async () => { expect(await authorizeSendRequest(req(KEY), base, db({ tables: { appointments: [{ id: "a", user_id: A, customer_id: "other" }] } }).admin, KEY)).toMatchObject({ allow: false, status: 403 }); });
  it("manual owner test accepted", async () => { expect(await authorizeSendRequest(req("user"), { user_id: A, test: true, to: base.to }, db().admin, KEY)).toMatchObject({ allow: true, test: true }); });
  it("internal test bypass denied", async () => { expect(await authorizeSendRequest(req(KEY), { ...base, test: true }, db().admin, KEY)).toMatchObject({ allow: false, status: 403 }); });
  it("active admin membership accepted", async () => { expect(await authorizeSendRequest(req("user"), base, db({ uid: B, tables: { user_roles: [], user_access: [{ owner_user_id: A, member_user_id: B, role: "admin", status: "active" }] } }).admin, KEY)).toMatchObject({ allow: true, tenantId: A }); });
  it("financial-only member denied", async () => { expect(await authorizeSendRequest(req("user"), base, db({ uid: B, tables: { user_roles: [], user_access: [{ owner_user_id: A, role: "financieel", status: "active" }] } }).admin, KEY)).toMatchObject({ allow: false, status: 403 }); });
  it("failed role lookup denied", async () => { expect(await authorizeSendRequest(req("user"), base, db({ lookupError: true }).admin, KEY)).toMatchObject({ allow: false, status: 403 }); });
  it("missing service configuration cannot authenticate", async () => { expect(await isServiceBearer(`Bearer ${KEY}`, undefined)).toBe(false); expect(await isServiceBearer(`Bearer ${KEY}x`, KEY)).toBe(false); });
});

describe("prepared retry snapshot validation", () => {
  const snapshot = { appointment_date: "2026-10-18T08:00:00Z", start_time: "10:00:00" };
  const row = { user_id: A, customer_id: "c", meta: { appointment_snapshot: snapshot } };
  const appointment = { ...snapshot, user_id: A, customer_id: "c", status: "gepland" };
  it("unchanged appointment allowed", () => expect(retryAppointmentVerdict(row, appointment)).toBeNull());
  it("deleted appointment blocked", () => expect(retryAppointmentVerdict(row, null)).toBe("appointment_no_longer_valid"));
  it("changed salon blocked", () => expect(retryAppointmentVerdict(row, { ...appointment, user_id: B })).toBe("appointment_no_longer_valid"));
  it("changed customer blocked", () => expect(retryAppointmentVerdict(row, { ...appointment, customer_id: "other" })).toBe("appointment_no_longer_valid"));
  it("cancelled appointment blocked", () => expect(retryAppointmentVerdict(row, { ...appointment, status: "geannuleerd" })).toBe("appointment_no_longer_valid"));
  it("declined appointment blocked", () => expect(retryAppointmentVerdict(row, { ...appointment, confirmation_status: "declined" })).toBe("appointment_no_longer_valid"));
  it("moved date blocked", () => expect(retryAppointmentVerdict(row, { ...appointment, appointment_date: "2026-10-19T08:00:00Z" })).toBe("appointment_changed"));
  it("moved start time blocked", () => expect(retryAppointmentVerdict(row, { ...appointment, start_time: "11:00:00" })).toBe("appointment_changed"));
  it("legacy body without proven snapshot blocked", () => expect(retryAppointmentVerdict({ ...row, meta: {} }, appointment)).toBe("appointment_snapshot_missing"));
});

// Execute the prepared transport with injected clients. No network, live
// identities, production writes or provider credentials are used.
describe("prepared transport demo and unauthorized paths", () => {
  async function run(token: string | undefined, demo: boolean) {
    let handler: any;
    const d = db({ invalid: token === "invalid" });
    const admin: any = d.admin;
    const original = admin.from;
    const insert = vi.fn(async () => ({ error: null }));
    admin.from = (table: string) => {
      if (table === "settings") { const q: any = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: { is_demo: demo }, error: null }) }; return q; }
      if (table === "whatsapp_logs") return { insert };
      return original(table);
    };
    const fetchMock = vi.fn(async () => { throw new Error("provider must not be called"); });
    const source = readFileSync("docs/prepared-patches/whatsapp-security/whatsapp-send.index.ts", "utf8").replace(/^import .*;\n/gm, "");
    // TypeScript transpilation only, no project build.
    const ts = await import("typescript");
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    new Function("createClient", "authorizeSendRequest", "maskPhone", "Deno", "fetch", js)(() => admin, authorizeSendRequest, () => "masked", { env: { get: (name: string) => name === "SUPABASE_SERVICE_ROLE_KEY" ? KEY : name === "SUPABASE_URL" ? "http://localhost" : undefined }, serve: (h: any) => { handler = h; } }, fetchMock);
    const r = await handler(new Request("http://localhost/whatsapp-send", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(base) }));
    return { status: r.status, body: await r.json(), fetchMock, insert };
  }
  it("anonymous request gets 401 without sending or logging", async () => { const r = await run(undefined, true); expect(r.status).toBe(401); expect(r.fetchMock).not.toHaveBeenCalled(); expect(r.insert).not.toHaveBeenCalled(); });
  it("demo simulates without provider configuration or network", async () => { const r = await run(KEY, true); expect(r.body).toMatchObject({ success: true, demo: true, simulated: true }); expect(r.fetchMock).not.toHaveBeenCalled(); expect(r.insert).toHaveBeenCalledOnce(); });
});

describe("isolated scheduler authentication and route proposal", () => {
  const request = (token?: string, body: unknown = {}, method = "POST") => new Request("http://localhost/scheduler", {
    method, headers: token ? { Authorization: `Bearer ${token}` } : {},
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  async function route(r: Request, d = db(), verifier?: (r: Request) => Promise<boolean>) {
    const dispatch = vi.fn();
    const runWrite = vi.fn();
    const lock = vi.fn();
    const decision = await authorizeSchedulerProposal(r, d.admin, verifier);
    if (decision.allow && decision.route !== "probe") {
      if (decision.route === "scheduled") { runWrite(); lock(); }
      dispatch(decision);
    }
    return { decision, dispatch, runWrite, lock };
  }
  it("anonymous {} denied before auth reads, logs, locks and dispatch", async () => {
    const d = db(); const r = await route(request(), d);
    expect(r.decision).toMatchObject({ allow: false, status: 401 });
    expect(d.calls).toEqual([]); expect(d.admin.auth.getUser).not.toHaveBeenCalled();
    expect(r.dispatch).not.toHaveBeenCalled(); expect(r.runWrite).not.toHaveBeenCalled(); expect(r.lock).not.toHaveBeenCalled();
  });
  it("user frontend {} becomes a no-dispatch probe", async () => {
    const r = await route(request("user"));
    expect(r.decision).toEqual({ allow: true, route: "probe", tenantId: A });
    expect(r.dispatch).not.toHaveBeenCalled(); expect(r.runWrite).not.toHaveBeenCalled(); expect(r.lock).not.toHaveBeenCalled();
  });
  it("valid internal transport key does not establish scheduled authority", async () => {
    const r = await route(request(KEY), db({ invalid: true }));
    expect(r.decision).toMatchObject({ allow: false, status: 401 }); expect(r.dispatch).not.toHaveBeenCalled();
  });
  it("verified scheduler fixture permits only the automated route", async () => {
    const d = db(); const r = await route(request("fictional-scheduler"), d, async () => true);
    expect(r.decision).toEqual({ allow: true, route: "scheduled" });
    expect(d.calls).toEqual([]); expect(d.admin.auth.getUser).not.toHaveBeenCalled();
    expect(r.dispatch).toHaveBeenCalledOnce(); expect(r.runWrite).toHaveBeenCalledOnce(); expect(r.lock).toHaveBeenCalledOnce();
  });
  it("failed scheduler verifier is fail-closed", async () => {
    const d = db(); const r = await route(request("wrong"), d, async () => { throw new Error("unavailable"); });
    expect(r.decision).toMatchObject({ allow: false, status: 401 }); expect(d.calls).toEqual([]); expect(r.dispatch).not.toHaveBeenCalled();
  });
  it("wrong token denied with rejecting verifier", async () => {
    const r = await route(request("wrong"), db({ invalid: true }), async () => false);
    expect(r.decision).toMatchObject({ allow: false, status: 401 }); expect(r.dispatch).not.toHaveBeenCalled();
  });
  it("anonymous GET is 401 and verified scheduler GET is 405", async () => {
    expect((await route(request(undefined, {}, "GET"))).decision).toMatchObject({ allow: false, status: 401 });
    const r = await route(request("scheduler", {}, "GET"), db(), async () => true);
    expect(r.decision).toMatchObject({ allow: false, status: 405 }); expect(r.dispatch).not.toHaveBeenCalled();
  });
  it("own-tenant manual appointment test keeps scoped dispatch", async () => {
    const r = await route(request("user", { test_appointment_id: "a" }));
    expect(r.decision).toEqual({ allow: true, route: "manual", tenantId: A, appointmentId: "a" });
    expect(r.dispatch).toHaveBeenCalledOnce(); expect(r.runWrite).not.toHaveBeenCalled();
  });
  it.each(["admin", "manager"])("active %s member manual test uses salon owner, not member ID", async role => {
    const d = db({ uid: B, tables: { user_roles: [], user_access: [{ member_user_id: B, owner_user_id: A, role, status: "active" }] } });
    expect((await route(request("user", { test_appointment_id: "a" }), d)).decision).toEqual({ allow: true, route: "manual", tenantId: A, appointmentId: "a" });
  });
  it("employee cannot use manual route", async () => {
    const d = db({ uid: B, tables: { user_roles: [], user_access: [{ member_user_id: B, owner_user_id: A, role: "medewerker", status: "active" }] } });
    const r = await route(request("user", { test_appointment_id: "a" }), d);
    expect(r.decision).toMatchObject({ allow: false, status: 403 }); expect(r.dispatch).not.toHaveBeenCalled();
  });
  it("cross-tenant appointment denied", async () => {
    const r = await route(request("user", { test_appointment_id: "a" }), db({ tables: { appointments: [{ id: "a", user_id: B }] } }));
    expect(r.decision).toMatchObject({ allow: false, status: 403 }); expect(r.dispatch).not.toHaveBeenCalled();
  });
  it("body salon cannot authorize a sweep", async () => {
    const r = await route(request("user", { user_id: B }));
    expect(r.decision).toMatchObject({ allow: false, status: 400 }); expect(r.dispatch).not.toHaveBeenCalled();
  });
  it("scheduler identity cannot invoke manual test bypass", async () => {
    const r = await route(request("scheduler", { test_appointment_id: "a" }), db(), async () => true);
    expect(r.decision).toMatchObject({ allow: false, status: 403 }); expect(r.dispatch).not.toHaveBeenCalled();
  });
});
