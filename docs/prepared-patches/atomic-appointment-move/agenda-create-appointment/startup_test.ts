// INACTIVE offline test. Starts the real entrypoint against a FICTIONAL local mock of Auth + PostgREST.
// Never contacts the project. Run: deno test -A startup_test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const STAFF = "55555555-5555-4555-8555-555555555555";
const SERVICE_KEY = "fictional-service-role-key-must-never-leak";
const body = { request_id: "60000000-0000-4000-8000-000000000001", customer_id: null,
  service_id: "a0000000-0000-4000-8000-000000000060", date: "2026-11-09", time: "10:00", employee_ids: [] };

type State = { flag: unknown; staffDemo: boolean; salonDemo: boolean; rpcCalls: any[]; rpcFail: boolean; authCalls: number; requests: Set<string> };
const st: State = { flag: true, staffDemo: false, salonDemo: false, rpcCalls: [], rpcFail: false, authCalls: 0, requests: new Set() };

const mock = Deno.serve({ port: 54399, onListen() {} }, async (req) => {
  const u = new URL(req.url); const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
  if (u.pathname === "/auth/v1/user") {
    st.authCalls++;
    const t = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (t === "jwt-owner") return j({ id: OWNER, aud: "authenticated" });
    if (t === "jwt-staff") return j({ id: STAFF, aud: "authenticated" });
    return j({ msg: "invalid JWT: token is expired" }, 401);
  }
  // service_role key must be used for data reads, never the user token
  if (u.pathname.startsWith("/rest/v1/") && req.headers.get("apikey") !== SERVICE_KEY && !u.pathname.includes("/rpc/")) return j({ message: "wrong key" }, 401);
  if (u.pathname === "/rest/v1/user_roles") return j(u.searchParams.get("user_id") === `eq.${OWNER}` ? [{ user_id: OWNER }] : []);
  if (u.pathname === "/rest/v1/user_access") return j(u.searchParams.get("member_user_id") === `eq.${STAFF}`
    ? [{ owner_user_id: OWNER, role: "receptie", is_demo: st.staffDemo, created_at: "2026-01-01" }] : []);
  if (u.pathname === "/rest/v1/settings") return j([{ is_demo: st.salonDemo, demo_mode: false, created_at: "2026-01-01" }]);
  if (u.pathname === "/rest/v1/tenant_feature_flags") {
    if (st.flag === "error") return j({ message: "boom" }, 500);
    return j({ atomic_agenda_enabled: st.flag });
  }
  if (u.pathname === "/rest/v1/rpc/create_appointment_atomic_as") {
    assertEquals(req.headers.get("apikey"), SERVICE_KEY);
    const a = await req.json(); st.rpcCalls.push(a);
    if (st.rpcFail) { st.rpcFail = false; st.requests.add(a._request_id); return j({ message: "connection reset" }, 500); } // committed, response lost
    const replay = st.requests.has(a._request_id); st.requests.add(a._request_id);
    return j({ ok: true, code: "created", replay, appointment_id: "70000000-0000-4000-8000-000000000001", send_confirmation: a._send_confirmation });
  }
  return j({ message: "not found" }, 404);
});

const fn = new Deno.Command(Deno.execPath(), { args: ["run", "-A", new URL("./index.ts", import.meta.url).pathname],
  env: { SUPABASE_URL: "http://127.0.0.1:54399", SUPABASE_ANON_KEY: "fictional-anon", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, PORT: "54398", DENO_SERVE_ADDRESS: "tcp:127.0.0.1:54398" },
  stdout: "null", stderr: "null" }).spawn();

async function post(jwt: string | null, b: unknown = body) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch("http://127.0.0.1:54398/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(b) });
      const text = await r.text(); return { status: r.status, text, json: JSON.parse(text), cors: r.headers.get("access-control-allow-origin") };
    } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("function did not start");
}

Deno.test({ name: "entrypoint starts, verifies via Auth, enforces salon/mode/flag, retries safely, never leaks key", sanitizeResources: false, sanitizeOps: false, async fn() {
  try {
    // start + OPTIONS
    const first = await post(null); assertEquals(first.status, 401); assertEquals(first.cors, "*");
    const opt = await fetch("http://127.0.0.1:54398/", { method: "OPTIONS" }); await opt.text(); assertEquals(opt.status, 200);
    // expired token: Auth server says no
    const exp = await post("jwt-expired"); assertEquals(exp.status, 401); assertEquals(exp.json.code, "not_authenticated");
    assert(st.authCalls >= 1, "token verified through Auth endpoint");
    // client-chosen salon refused
    assertEquals((await post("jwt-owner", { ...body, tenant_id: STAFF })).status, 400);
    // owner creates; actor is verified id
    const ok = await post("jwt-owner"); assertEquals(ok.status, 200); assertEquals(st.rpcCalls.at(-1)._actor, OWNER);
    assert(!("_source" in st.rpcCalls.at(-1)));
    // staff mode mismatch
    st.salonDemo = true; st.staffDemo = false;
    const mm = await post("jwt-staff", { ...body, request_id: "60000000-0000-4000-8000-000000000002" });
    assertEquals(mm.json.code, "mode_mismatch"); st.salonDemo = false;
    // flag off / unreadable: no RPC
    const n = st.rpcCalls.length;
    st.flag = false; assertEquals((await post("jwt-staff", { ...body, request_id: "60000000-0000-4000-8000-000000000003" })).json.code, "disabled");
    st.flag = "error"; assertEquals((await post("jwt-staff", { ...body, request_id: "60000000-0000-4000-8000-000000000003" })).json.code, "unavailable");
    assertEquals(st.rpcCalls.length, n); st.flag = true;
    // lost response after commit -> retry same id -> replay
    st.rpcFail = true;
    const lost = await post("jwt-staff", { ...body, request_id: "60000000-0000-4000-8000-000000000004" });
    assertEquals(lost.status, 503); assertEquals(lost.json.retry_same_request, true);
    const again = await post("jwt-staff", { ...body, request_id: "60000000-0000-4000-8000-000000000004" });
    assertEquals(again.json.replay, true); assertEquals(st.rpcCalls.at(-1)._actor, STAFF);
    // key never in any response
    for (const r of [first, exp, ok, mm, lost, again]) assert(!r.text.includes(SERVICE_KEY));
  } finally {
    fn.kill(); await fn.status; await mock.shutdown();
  }
}});
