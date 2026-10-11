// Deno test for the INACTIVE prepared sender. Fictional data only; all network is mocked.
// Run: deno test -A tests/send-white-label-email/prepared_sender_test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SVC = "svc-key-fictief-0000000000";
const P = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // fictional platform admin, no salon roles
const TESTADDR = "test@glowsuite-fictief.test";

Deno.env.set("SUPABASE_URL", "http://mock.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SVC);
Deno.env.set("LOVABLE_API_KEY", "lov-fictief");
Deno.env.set("RESEND_API_KEY", "re-fictief");

const logs: any[] = [];
const sends: { headers: Headers; body: any }[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = new Request(input, init);
  const u = new URL(req.url);
  const q = decodeURIComponent(u.search);
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (u.host === "connector-gateway.lovable.dev") {
    sends.push({ headers: req.headers, body: await req.json() });
    return j({ id: `msg-${sends.length}` });
  }
  if (u.pathname === "/auth/v1/user") {
    const t = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (t === "jwt-owner-A") return j({ id: A, aud: "authenticated" });
    if (t === "jwt-owner-B") return j({ id: B, aud: "authenticated" });
    if (t === "jwt-platform") return j({ id: P, aud: "authenticated" });
    return j({ message: "invalid" }, 401);
  }
  const t = u.pathname.replace("/rest/v1/", "");
  if (t === "user_roles") return j(q.includes(`user_id=eq.${A}`) || q.includes(`user_id=eq.${B}`) ? [{ role: "eigenaar" }] : []);
  if (t === "user_access") return j([]);
  if (t === "settings") {
    const id = q.includes(A) ? A : q.includes(B) ? B : null;
    return j(id ? [{ user_id: id, salon_name: id === A ? "Fictief Salon A" : "Fictief Salon B", public_slug: id === A ? "fictief-a" : "fictief-b", whitelabel_branding: {}, demo_mode: false, is_demo: false, language: "nl" }] : []);
  }
  if (t === "profiles") return j([]);
  if (t === "customers") return j(q.includes(`user_id=eq.${A}`) && q.toLowerCase().includes("klant@voorbeeld.test") && q.includes("select=id") ? [{ id: "k1" }] : []);
  if (t === "white_label_email_logs") {
    if (req.method === "POST") { const b = await req.json(); (Array.isArray(b) ? b : [b]).forEach((x) => logs.push(x)); return j([], 201); }
    const m = /metadata->>idempotency_key=eq\.([^&]+)/.exec(q);
    return j(logs.filter((l) => l.status === "sent" && m && l.metadata?.idempotency_key === m[1] && q.includes(`user_id=eq.${l.user_id}`)).map((l) => ({ id: "l", provider_message_id: l.provider_message_id })));
  }
  return realFetch(input as any, init);
}) as typeof fetch;

let handler: (r: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; return {} as any; };
await import("../../supabase/functions/send-white-label-email/index.ts");

const T = (name: string, fn: () => Promise<void>) => Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
const call = async (auth: string | null, body: Record<string, unknown>) => {
  const res = await handler(new Request("http://x/send", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const booking = (over: Record<string, unknown> = {}) => ({
  user_id: A, salon_slug: "fictief-a", recipient_email: "klant@voorbeeld.test", recipient_name: "Test Klant",
  template_key: "booking_confirmation", idempotency_key: "public-booking-confirmation-fictief-1",
  template_data: { date: "2026-10-16", time: "10:30", service_name: "Fictieve behandeling" }, ...over,
});

T("public booking (service caller) with token: sent, valid manage button, HTTP idempotency header", async () => {
  const r = await call(SVC, booking({ template_data: { date: "2026-10-16", time: "10:30", manage_url: `https://glowsuite.nl/mijn-afspraak/${TOKEN}` } }));
  assertEquals(r.status, 200);
  const s = sends.at(-1)!;
  assertEquals(s.headers.get("idempotency-key"), "public-booking-confirmation-fictief-1");
  assert(s.body.html.includes(`https://glowsuite.nl/mijn-afspraak/${TOKEN}`));
  assert(!s.body.html.includes("/afspraak/beheer"));
  assertEquals(s.body.headers, undefined);
});

T("repeat with the same key: no second provider call", async () => {
  const before = sends.length;
  const r = await call(SVC, booking({ template_data: { manage_url: `https://glowsuite.nl/mijn-afspraak/${TOKEN}` } }));
  assertEquals(r.status, 200); assertEquals(r.body.duplicate, true); assertEquals(sends.length, before);
});

T("missing or invalid manage link: no manage button, no invented link", async () => {
  for (const [i, md] of [{}, { manage_url: "https://fictief-a.glowsuite.nl/afspraak/beheer" }, { manage_url: "https://glowsuite.nl/mijn-afspraak/niet-een-token" }].entries()) {
    await call(SVC, booking({ idempotency_key: `no-link-fictief-${i}`, template_data: { date: "2026-10-16", ...md } }));
    const html: string = sends.at(-1)!.body.html;
    assert(!html.includes("/afspraak/beheer") && !html.includes("/mijn-afspraak/"), `case ${i}`);
  }
});

T("invalid callers are refused before anything is read or sent", async () => {
  const before = sends.length;
  assertEquals((await call(null, booking({ idempotency_key: "x-fictief-1" }))).status, 401);
  assertEquals((await call("verzonnen-token", booking({ idempotency_key: "x-fictief-2" }))).status, 401);
  assertEquals((await call(SVC + "x", booking({ idempotency_key: "x-fictief-3" }))).status, 401);
  assertEquals(sends.length, before);
});

T("other salon: owner of B cannot send or preview for A", async () => {
  const before = sends.length;
  assertEquals((await call("jwt-owner-B", booking({ idempotency_key: "other-fictief-1" }))).status, 403);
  assertEquals((await call("jwt-owner-B", booking({ idempotency_key: "other-fictief-2", preview_only: true }))).status, 403);
  assertEquals(sends.length, before);
});

T("own salon user: only to a stored customer of that salon", async () => {
  const before = sends.length;
  assertEquals((await call("jwt-owner-A", booking({ idempotency_key: "own-fictief-1", recipient_email: "vreemd@voorbeeld.test" }))).status, 403);
  assertEquals(sends.length, before);
  assertEquals((await call("jwt-owner-A", booking({ idempotency_key: "own-fictief-2" }))).status, 200);
  assertEquals(sends.length, before + 1);
});

const withPlatformEnv = async (fn: () => Promise<void>) => {
  Deno.env.set("PLATFORM_ADMIN_USER_IDS", P);
  Deno.env.set("PLATFORM_TEST_RECIPIENTS", TESTADDR);
  try { await fn(); } finally { Deno.env.delete("PLATFORM_ADMIN_USER_IDS"); Deno.env.delete("PLATFORM_TEST_RECIPIENTS"); }
};

T("platform admin (allowlist) previews another salon's template", () => withPlatformEnv(async () => {
  const r = await call("jwt-platform", booking({ user_id: B, salon_slug: "fictief-b", preview_only: true, idempotency_key: "admin-preview-b" }));
  assertEquals(r.status, 200); assertEquals(r.body.preview_only, true);
}));

T("platform admin test send: only to approved test address", () => withPlatformEnv(async () => {
  const before = sends.length;
  const bad = await call("jwt-platform", booking({ user_id: B, salon_slug: "fictief-b", idempotency_key: "admin-test-real" }));
  assertEquals(bad.status, 403); assertEquals(sends.length, before);
  const ok = await call("jwt-platform", booking({ user_id: B, salon_slug: "fictief-b", recipient_email: TESTADDR, idempotency_key: "admin-test-ok" }));
  assertEquals(ok.status, 200); assertEquals(sends.length, before + 1);
  assertEquals(sends.at(-1)!.body.to, [TESTADDR]);
}));

T("no allowlist configured: nobody is platform admin (fail-closed)", async () => {
  const r = await call("jwt-platform", booking({ user_id: B, salon_slug: "fictief-b", preview_only: true, idempotency_key: "admin-preview-noenv" }));
  assertEquals(r.status, 403);
});

T("salon owner role gives no platform rights: owner A cannot preview salon B even with allowlist set", () => withPlatformEnv(async () => {
  const r = await call("jwt-owner-A", booking({ user_id: B, salon_slug: "fictief-b", preview_only: true, idempotency_key: "a-preview-b" }));
  assertEquals(r.status, 403);
}));
