// Round 8C (supersedes the 8B guard tests). Fictitious data, fully mocked deps and provider.
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  guardedSend, verifyServiceRequest, handleServiceSend, identityFromVerifiedJwt, isVerifiedIdentity, ANONYMOUS,
  signingString, SEND_PATH, type Deps, type CustomerRow, type ClaimState, type Identity, type ServiceVerifyDeps,
  type ServiceKeyConfig, type SignedRequest, type ServiceCaller,
} from "../../supabase/functions/_shared/inactive/whatsappSendGuard";

const SA = "11111111-1111-1111-1111-111111111111", SB = "22222222-2222-2222-2222-222222222222";
const OWNER_A = SA, ADMIN_A = "a0000000-0000-0000-0000-00000000000a", EMP_A = "a0000000-0000-0000-0000-00000000000c";
const FIN_A = "a0000000-0000-0000-0000-00000000000f";
const CA = "c0000000-0000-0000-0000-0000000000a1", CB = "c0000000-0000-0000-0000-0000000000b1", CA2 = "c0000000-0000-0000-0000-0000000000a9";
const APPT_A = "d0000000-0000-0000-0000-0000000000a1", APPT_B = "d0000000-0000-0000-0000-0000000000b1";
const APPT_NOCUST = "d0000000-0000-0000-0000-0000000000a2";
const RUN_1 = "e0000000-0000-0000-0000-000000000001";

const cust = (o: Partial<CustomerRow> = {}): CustomerRow => ({ id: CA, user_id: SA, phone: "0612345678",
  whatsapp_opt_in: true, marketing_consent: true, archived_at: null, pseudonymized_at: null, communication_blocked_at: null, ...o });

type W = { customers?: CustomerRow[]; stopped?: string[]; prefOut?: string[]; transport?: Deps["transport"];
  finalizeFails?: boolean; demo?: boolean; slowClaim?: boolean; now?: number; over?: Partial<Deps> };
function world(o: W = {}) {
  const customers = new Map((o.customers ?? [cust(), cust({ id: CB, user_id: SB, phone: "+31612345679" }),
    cust({ id: CA2, phone: "+31612345670" })]).map((c) => [c.id, c]));
  const roles: Record<string, [string, string]> = { [OWNER_A]: [SA, "eigenaar"], [ADMIN_A]: [SA, "admin"], [EMP_A]: [SA, "medewerker"], [FIN_A]: [SA, "financieel"] };
  const claims = new Map<string, { state: ClaimState; fp: string }>();
  const transport = vi.fn(o.transport ?? (async () => ({ accepted: true, sid: "SM_fake" })));
  const finalize = vi.fn(async (t: string, k: string, s: ClaimState, _log: unknown) => {
    if (o.finalizeFails) throw new Error("db down");
    claims.set(`${t}|${k}`, { ...claims.get(`${t}|${k}`)!, state: s });
  });
  const deps: Deps = {
    tenantOfUser: async (u) => roles[u]?.[0] ?? null,
    roleInTenant: async (u, t) => (roles[u]?.[0] === t ? (roles[u][1] as never) : null),
    customer: async (id) => customers.get(id) ?? null,
    appointment: async (id) => ({ [APPT_A]: { user_id: SA, customer_id: CA }, [APPT_B]: { user_id: SB, customer_id: CB },
      [APPT_NOCUST]: { user_id: SA, customer_id: null } } as Record<string, { user_id: string; customer_id: string | null }>)[id] ?? null,
    preferenceWhatsappOptOut: async (_t, c) => ((o.prefOut ?? []).includes(c) ? true : null),
    isStopped: async (t, p) => (o.stopped ?? []).includes(`${t}:${p}`),
    whatsappEnabled: async () => true, sendingPaused: async () => false,
    isDemoTenant: async () => !!o.demo,
    claim: async (t, k, fp) => {
      if (o.slowClaim) await new Promise((r) => setTimeout(r, 5));
      const e = claims.get(`${t}|${k}`);
      if (e) return { created: false, state: e.state, fingerprint: e.fp };
      claims.set(`${t}|${k}`, { state: "claimed", fp }); return { created: true };
    },
    finalize, transport,
    hmac: async (p, v) => createHmac("sha256", "test-only-fictitious-key").update(`${p}|${v}`).digest("hex"),
    // 8D: fictitious event rows; appointments start 20h after NOW.
    now: () => o.now ?? NOW,
    resolveEvent: async (type, id) => {
      const appts: Record<string, [string, string | null]> = { [APPT_A]: [SA, CA], [APPT_B]: [SB, CB], [APPT_NOCUST]: [SA, null] };
      if (type === "appointment" && appts[id]) return { type, id, user_id: appts[id][0], customer_id: appts[id][1], status: "gepland", starts_at_ms: NOW + 24 * 3600e3 };
      if (type === "automation_run" && id === RUN_1) return { type, id, user_id: SA, customer_id: CA, appointment_id: null, status: "scheduled" };
      if (type === "rebook_action" && id === RUN_1) return { type, id, user_id: SA, customer_id: CA, appointment_id: null, reversed_at: null };
      return null;
    },
    ...o.over,
  };
  return { deps, transport, finalize, claims };
}

// --- verified identities, minted only through the real verification paths ---
const KEY = new Uint8Array(32).fill(7), KEY2 = new Uint8Array(32).fill(9);
const NOW = 1_800_000_000_000;
const ALL: ServiceCaller[] = ["reminder-scheduler", "automation-scheduler", "auto-rebook", "booking-confirmation", "payment-webhook", "customer-forms"];
const cfg = (): ServiceKeyConfig => Object.fromEntries(ALL.map((c) => [c, { current: "1", keys: { "1": KEY } }]));
function vdeps(over: Partial<ServiceVerifyDeps> = {}): ServiceVerifyDeps {
  const seen = new Set<string>();
  return { keys: cfg(), now: () => NOW,
    hmacHex: async (k, m) => createHmac("sha256", Buffer.from(k)).update(m).digest("hex"),
    sha256Hex: async (m) => createHash("sha256").update(m).digest("hex"),
    rememberNonce: async (c, n) => (seen.has(c + n) ? false : (seen.add(c + n), true)), ...over };
}
function signed(caller: string, rawBody: string, o: { key?: Uint8Array; keyId?: string; ts?: string; nonce?: string; method?: string; path?: string; signPath?: string; signMethod?: string } = {}): SignedRequest {
  const ts = o.ts ?? "1800000000", nonce = o.nonce ?? createHash("md5").update(randomUUID()).digest("hex"), keyId = o.keyId ?? "1";
  const msg = signingString(o.signMethod ?? o.method ?? "POST", o.signPath ?? o.path ?? SEND_PATH, caller, keyId, ts, nonce, createHash("sha256").update(rawBody).digest("hex"));
  return { method: o.method ?? "POST", path: o.path ?? SEND_PATH, rawBody,
    headers: { caller, keyId, ts, nonce, sig: createHmac("sha256", Buffer.from(o.key ?? KEY)).update(msg).digest("hex") } };
}
async function svc(caller: ServiceCaller = "reminder-scheduler"): Promise<Identity> {
  const r = await verifyServiceRequest(signed(caller, "{}"), vdeps());
  if (r.ok === false) throw new Error(r.reason); return r.identity;
}
const jwtOk = async (t: string) => (t.startsWith("valid.") ? { sub: t.slice(6) } : null);
async function user(u: string): Promise<Identity> { return identityFromVerifiedJwt(`Bearer valid.${u}`, jwtOk); }

const reminder = { message: "Herinnering", kind: "reminder", appointment_id: APPT_A, reminder_type: "24h", event_ref: `appointment:${APPT_A}:24h` };
const manual = (o: Record<string, unknown> = {}) => ({ message: "Hallo", kind: "manual", customer_id: CA, action_id: randomUUID(), ...o });

describe("1. idempotency: manual sends", () => {
  it("two deliberate sends with identical text to the same customer are NOT duplicates", async () => {
    const w = world(); const u = await user(ADMIN_A);
    expect(await guardedSend(u, manual(), w.deps)).toMatchObject({ ok: true });
    expect(await guardedSend(u, manual(), w.deps)).toMatchObject({ ok: true });
    expect(w.transport).toHaveBeenCalledTimes(2);
  });
  it("a retry of one action (same action_id) is deduplicated", async () => {
    const w = world(); const u = await user(ADMIN_A); const m = manual();
    expect(await guardedSend(u, m, w.deps)).toMatchObject({ ok: true });
    expect(await guardedSend(u, m, w.deps)).toMatchObject({ status: 409, reason: "duplicate" });
    expect(w.transport).toHaveBeenCalledTimes(1);
  });
  it("missing action id -> refused (no automatic content-derived key)", async () => {
    const w = world();
    expect(await guardedSend(await user(ADMIN_A), { message: "Hallo", kind: "manual", customer_id: CA }, w.deps)).toMatchObject({ status: 422, reason: "action_id_required" });
    expect(w.claims.size).toBe(0);
  });
  it("explicit invalid key -> refused, never silently replaced", async () => {
    const u = await user(ADMIN_A);
    for (const bad of ["short", "camp-2026-10-001", "x".repeat(300), 42, "", "11111111-1111-1111-1111-11111111111g"]) {
      const w = world();
      expect(await guardedSend(u, manual({ action_id: bad }), w.deps)).toMatchObject({ status: 422, reason: "invalid_action_id" });
      expect(w.claims.size).toBe(0); expect(w.transport).not.toHaveBeenCalled();
    }
    expect(await guardedSend(u, manual({ action_id: undefined, idempotency_key: "bad key" }), world().deps)).toMatchObject({ reason: "invalid_action_id" });
    expect(await guardedSend(u, manual({ idempotency_key: randomUUID() }), world().deps)).toMatchObject({ reason: "action_id_mismatch" });
  });
  it("same action id with changed recipient, content or purpose -> conflict", async () => {
    const u = await user(ADMIN_A); const id = randomUUID();
    const w = world();
    await guardedSend(u, manual({ action_id: id }), w.deps);
    expect(await guardedSend(u, manual({ action_id: id, customer_id: CA2 }), w.deps)).toMatchObject({ reason: "idempotency_conflict" });
    expect(await guardedSend(u, manual({ action_id: id, message: "Anders" }), w.deps)).toMatchObject({ reason: "idempotency_conflict" });
    expect(await guardedSend(u, manual({ action_id: id, kind: "waitlist_offer" }), w.deps)).toMatchObject({ reason: "idempotency_conflict" });
    expect(w.transport).toHaveBeenCalledTimes(1);
  });
  it("action ids are tenant scoped: other salon reusing the id is independent", async () => {
    const w = world({ customers: [cust(), cust({ id: CB, user_id: SB, phone: "+31612345679" })] });
    const id = randomUUID();
    await guardedSend(await user(ADMIN_A), manual({ action_id: id }), w.deps);
    expect([...w.claims.keys()].every((k) => k.startsWith(SA))).toBe(true);
  });
});

describe("1b. idempotency: internal sends bound to the business event", () => {
  it("same appointment+slot -> one send; other slot -> new send", async () => {
    const w = world(); const s = await svc();
    expect(await guardedSend(s, reminder, w.deps)).toMatchObject({ ok: true });
    expect(await guardedSend(s, reminder, w.deps)).toMatchObject({ reason: "duplicate" });
    // 2h slot is a separate claim; checked 2h before start (8D reminder windows).
    const w2 = world({ now: NOW + 22 * 3600e3 });
    expect(await guardedSend(s, { ...reminder, event_ref: `appointment:${APPT_A}:2h` }, w2.deps)).toMatchObject({ ok: true });
    expect(w.transport).toHaveBeenCalledTimes(1); expect(w2.transport).toHaveBeenCalledTimes(1);
  });
  it("same event with changed content -> conflict", async () => {
    const w = world(); const s = await svc();
    await guardedSend(s, reminder, w.deps);
    expect(await guardedSend(s, { ...reminder, message: "Andere tekst" }, w.deps)).toMatchObject({ reason: "idempotency_conflict" });
  });
  it("two schedulers for the same appointment event dedupe across callers", async () => {
    const w = world();
    const conf = { message: "Bevestigd", kind: "confirmation", appointment_id: APPT_A, event_ref: `appointment:${APPT_A}` };
    expect(await guardedSend(await svc("booking-confirmation"), conf, w.deps)).toMatchObject({ ok: true });
    expect(await guardedSend(await svc("payment-webhook"), conf, w.deps)).toMatchObject({ reason: "duplicate" });
  });
  it("missing / malformed / mismatched event_ref -> 422", async () => {
    const s = await svc();
    expect(await guardedSend(s, { ...reminder, event_ref: undefined }, world().deps)).toMatchObject({ status: 422, reason: "event_ref_required" });
    expect(await guardedSend(s, { ...reminder, event_ref: "appointment:nope" }, world().deps)).toMatchObject({ reason: "invalid_event_ref" });
    expect(await guardedSend(s, { ...reminder, event_ref: `appointment:${APPT_A}` }, world().deps)).toMatchObject({ reason: "event_slot_required" });
    expect(await guardedSend(s, { ...reminder, event_ref: `appointment:${APPT_B}:24h` }, world().deps)).toMatchObject({ reason: "event_appointment_mismatch" });
    expect(await guardedSend(s, { ...reminder, event_ref: `automation_run:${RUN_1}` }, world().deps)).toMatchObject({ reason: "event_type_mismatch" });
  });
  it("service may not supply a client action id / idempotency key", async () => {
    expect(await guardedSend(await svc(), { ...reminder, idempotency_key: randomUUID() }, world().deps)).toMatchObject({ reason: "client_key_not_allowed_for_service" });
  });
  it("automation needs its run id and a customer (current caller sends customer_id null)", async () => {
    const a = await svc("automation-scheduler");
    expect(await guardedSend(a, { message: "x", kind: "automation", customer_id: null, event_ref: `automation_run:${RUN_1}` }, world().deps)).toMatchObject({ reason: "recipient_unverified" });
    expect(await guardedSend(a, { message: "x", kind: "automation", customer_id: CA, event_ref: `automation_run:${RUN_1}` }, world().deps)).toMatchObject({ ok: true });
  });
  it("concurrent identical requests -> one provider call", async () => {
    const w = world({ slowClaim: true }); const s = await svc();
    const rs = await Promise.all([1, 2, 3].map(() => guardedSend(s, reminder, w.deps)));
    expect(w.transport).toHaveBeenCalledTimes(1);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
  });
  it("uncertain provider outcome / finalize failure -> never resent", async () => {
    const s = await svc();
    const w = world({ transport: async () => { throw new Error("timeout"); } });
    expect(await guardedSend(s, reminder, w.deps)).toMatchObject({ reason: "outcome_unknown" });
    expect(await guardedSend(s, reminder, w.deps)).toMatchObject({ reason: "outcome_unknown" });
    expect(w.transport).toHaveBeenCalledTimes(1);
    const w2 = world({ finalizeFails: true });
    expect(await guardedSend(s, reminder, w2.deps)).toMatchObject({ ok: true });
    expect(await guardedSend(s, reminder, w2.deps)).toMatchObject({ reason: "outcome_unknown" });
    expect(w2.transport).toHaveBeenCalledTimes(1);
  });
  it("claim store down -> 503, no provider call", async () => {
    const w = world({ over: { claim: async () => { throw new Error("db down"); } } });
    expect(await guardedSend(await svc(), reminder, w.deps)).toMatchObject({ status: 503, reason: "claim_store_unavailable" });
    expect(w.transport).not.toHaveBeenCalled();
  });
});

describe("2. internal authentication", () => {
  const body = JSON.stringify(reminder);
  it("valid signature -> verified service identity", async () => {
    const r = await verifyServiceRequest(signed("reminder-scheduler", body), vdeps());
    expect(r).toMatchObject({ ok: true }); if (r.ok) expect(isVerifiedIdentity(r.identity)).toBe(true);
  });
  it("tampered body, other caller name, other route, other method -> refused", async () => {
    const d = vdeps();
    const t = signed("reminder-scheduler", body); t.rawBody = body + " ";
    expect(await verifyServiceRequest(t, d)).toMatchObject({ reason: "bad_signature" });
    const c = signed("reminder-scheduler", body); c.headers.caller = "auto-rebook";
    expect(await verifyServiceRequest(c, d)).toMatchObject({ reason: "bad_signature" });
    expect(await verifyServiceRequest(signed("reminder-scheduler", body, { signPath: "/functions/v1/other" }), d)).toMatchObject({ reason: "bad_signature" });
    expect(await verifyServiceRequest(signed("reminder-scheduler", body, { path: "/functions/v1/other" }), d)).toMatchObject({ reason: "wrong_route" });
    expect(await verifyServiceRequest(signed("reminder-scheduler", body, { method: "PUT" }), d)).toMatchObject({ reason: "wrong_route" });
  });
  it("a caller cannot sign as another caller with its own key", async () => {
    expect(await verifyServiceRequest(signed("payment-webhook", body, { key: new Uint8Array(32).fill(1) }), vdeps())).toMatchObject({ reason: "bad_signature" });
  });
  it("timestamp window enforced both directions", async () => {
    expect(await verifyServiceRequest(signed("reminder-scheduler", body, { ts: "1799999600" }), vdeps())).toMatchObject({ reason: "stale_timestamp" });
    expect(await verifyServiceRequest(signed("reminder-scheduler", body, { ts: "1800000400" }), vdeps())).toMatchObject({ reason: "stale_timestamp" });
    expect(await verifyServiceRequest(signed("reminder-scheduler", body, { ts: "1800000299" }), vdeps())).toMatchObject({ ok: true });
  });
  it("nonce replay refused; nonce store failure or odd answer refused", async () => {
    const d = vdeps(); const r = signed("reminder-scheduler", body);
    expect(await verifyServiceRequest(r, d)).toMatchObject({ ok: true });
    expect(await verifyServiceRequest(r, d)).toMatchObject({ reason: "replay" });
    expect(await verifyServiceRequest(signed("reminder-scheduler", body), vdeps({ rememberNonce: async () => { throw new Error("down"); } }))).toMatchObject({ reason: "nonce_store_unavailable" });
    expect(await verifyServiceRequest(signed("reminder-scheduler", body), vdeps({ rememberNonce: async () => "yes" as never }))).toMatchObject({ reason: "replay" });
  });
  it("key rotation: old and new key id accepted while listed; removed key refused", async () => {
    const rot: ServiceKeyConfig = { ...cfg(), "reminder-scheduler": { current: "2", keys: { "1": KEY, "2": KEY2 } } };
    expect(await verifyServiceRequest(signed("reminder-scheduler", body, { keyId: "2", key: KEY2 }), vdeps({ keys: rot }))).toMatchObject({ ok: true });
    expect(await verifyServiceRequest(signed("reminder-scheduler", body, { keyId: "1", key: KEY }), vdeps({ keys: rot }))).toMatchObject({ ok: true });
    const after: ServiceKeyConfig = { ...cfg(), "reminder-scheduler": { current: "2", keys: { "2": KEY2 } } };
    expect(await verifyServiceRequest(signed("reminder-scheduler", body, { keyId: "1" }), vdeps({ keys: after }))).toMatchObject({ reason: "unknown_key_id" });
    expect(await verifyServiceRequest(signed("reminder-scheduler", body, { keyId: "2", key: KEY }), vdeps({ keys: rot }))).toMatchObject({ reason: "bad_signature" });
  });
  it("missing or invalid configuration denies everything", async () => {
    const r = signed("reminder-scheduler", body);
    expect(await verifyServiceRequest(r, vdeps({ keys: null }))).toMatchObject({ reason: "service_auth_not_configured" });
    const short = { ...cfg(), "auto-rebook": { current: "1", keys: { "1": new Uint8Array(16) } } };
    expect(await verifyServiceRequest(r, vdeps({ keys: short }))).toMatchObject({ reason: "service_auth_misconfigured" });
    const noCur = { ...cfg(), "auto-rebook": { current: "3", keys: { "1": KEY } } };
    expect(await verifyServiceRequest(r, vdeps({ keys: noCur }))).toMatchObject({ reason: "service_auth_misconfigured" });
    expect(await verifyServiceRequest(r, vdeps({ keys: { evil: { current: "1", keys: { "1": KEY } } } as never }))).toMatchObject({ reason: "service_auth_misconfigured" });
    expect(await verifyServiceRequest(r, vdeps({ keys: { "reminder-scheduler": { current: "1", keys: { "1": "text-key-not-bytes-000000000000000" } } } as never }))).toMatchObject({ reason: "service_auth_misconfigured" });
  });
  it("forged identity objects are refused by the pipeline", async () => {
    const w = world();
    for (const fake of [{ kind: "service", caller: "reminder-scheduler" }, { kind: "user", userId: OWNER_A }, Object.freeze({ kind: "service", caller: "payment-webhook" })])
      expect(await guardedSend(fake as Identity, reminder, w.deps)).toMatchObject({ status: 401, reason: "identity_not_verified" });
    expect(w.transport).not.toHaveBeenCalled();
    expect(isVerifiedIdentity(ANONYMOUS)).toBe(true);
    const s = await svc(); expect(() => { (s as { caller: string }).caller = "auto-rebook"; }).toThrow();
  });
  it("caller / role fields in the body never create an identity", async () => {
    const w = world();
    const body2 = JSON.stringify({ ...reminder, caller: "payment-webhook", identity: { kind: "service" }, role: "eigenaar", kind: "confirmation", event_ref: `appointment:${APPT_A}` });
    expect(await handleServiceSend(signed("reminder-scheduler", body2), vdeps(), w.deps)).toMatchObject({ reason: "kind_not_allowed_for_caller" });
  });
  it("handleServiceSend executes exactly the signed bytes", async () => {
    const w = world(); const raw = JSON.stringify(reminder);
    expect(await handleServiceSend(signed("reminder-scheduler", raw), vdeps(), w.deps)).toMatchObject({ ok: true });
    expect(w.transport.mock.calls[0][1]).toBe("Herinnering");
    expect(await handleServiceSend(signed("reminder-scheduler", "not json"), vdeps(), world().deps)).toMatchObject({ status: 400 });
    expect(await handleServiceSend({ ...signed("reminder-scheduler", raw), rawBody: JSON.stringify({ ...reminder, message: "evil" }) }, vdeps(), world().deps)).toMatchObject({ status: 401 });
  });
  it("JWT path: invalid / throwing verifier / malformed sub -> anonymous", async () => {
    for (const [h, v] of [[undefined, jwtOk], ["Bearer x", jwtOk], ["Bearer valid.notauuid000000000000", jwtOk],
      [`Bearer valid.${OWNER_A}`, async () => { throw new Error("down"); }]] as const)
      expect((await identityFromVerifiedJwt(h as string | undefined, v as never)).kind).toBe("anonymous");
    expect(await guardedSend(await identityFromVerifiedJwt(undefined, jwtOk), manual(), world().deps)).toMatchObject({ status: 401, reason: "unauthenticated" });
  });
  it("verified caller limited to its own kinds", async () => {
    expect(await guardedSend(await svc(), { ...reminder, kind: "campaign" }, world().deps)).toMatchObject({ status: 403, reason: "kind_not_allowed_for_caller" });
    expect(await guardedSend(await svc("automation-scheduler"), reminder, world().deps)).toMatchObject({ reason: "kind_not_allowed_for_caller" });
  });
});

describe("4. consent fail-closed", () => {
  const STOPPED = `${SA}:+31612345678`;
  it("STOP lookup error or odd value -> 503 blocked", async () => {
    const s = await svc();
    for (const isStopped of [async () => { throw new Error("db"); }, async () => null, async () => "false", async () => undefined] as never[]) {
      const w = world({ over: { isStopped } });
      expect(await guardedSend(s, reminder, w.deps)).toMatchObject({ status: 503, reason: "consent_lookup_failed" });
      expect(w.transport).not.toHaveBeenCalled(); expect(w.claims.size).toBe(0);
    }
  });
  it("preference lookup error or odd value -> 503 blocked", async () => {
    const s = await svc();
    for (const p of [async () => { throw new Error("db"); }, async () => "no", async () => undefined, async () => 0] as never[])
      expect(await guardedSend(s, reminder, world({ over: { preferenceWhatsappOptOut: p } }).deps)).toMatchObject({ status: 503 });
  });
  it("settings lookup error -> blocked", async () => {
    expect(await guardedSend(await svc(), reminder, world({ over: { whatsappEnabled: async () => { throw new Error("x"); } } }).deps)).toMatchObject({ status: 503 });
    expect(await guardedSend(await svc(), reminder, world({ over: { whatsappEnabled: async () => "true" as never } }).deps)).toMatchObject({ reason: "whatsapp_disabled" });
  });
  it("missing / unclear consent stays blocked", async () => {
    for (const v of [null, undefined, "true", 1] as never[])
      expect(await guardedSend(await svc(), reminder, world({ customers: [cust({ whatsapp_opt_in: v })] }).deps)).toMatchObject({ status: 409 });
  });
  it("STOP and preference opt-out win, also for transactional and test", async () => {
    expect(await guardedSend(await svc(), reminder, world({ stopped: [STOPPED] }).deps)).toMatchObject({ reason: "customer_stopped" });
    expect(await guardedSend(await svc(), reminder, world({ prefOut: [CA] }).deps)).toMatchObject({ reason: "preference_opted_out" });
    expect(await guardedSend(await user(OWNER_A), manual({ test: true, kind: "test" }), world({ stopped: [STOPPED] }).deps)).toMatchObject({ reason: "customer_stopped" });
  });
  it("marketing requires marketing_consent; transactional classification does not create it", async () => {
    const w = world({ customers: [cust({ marketing_consent: null })] });
    expect(await guardedSend(await svc("auto-rebook"), { message: "x", kind: "auto_rebook", customer_id: CA, event_ref: `rebook_action:${RUN_1}` }, w.deps)).toMatchObject({ reason: "marketing_consent_missing" });
    expect(await guardedSend(await svc(), { ...reminder, kind: "review", event_ref: `appointment:${APPT_A}` }, w.deps)).toMatchObject({ reason: "marketing_consent_missing" });
    expect(await guardedSend(await svc(), reminder, w.deps)).toMatchObject({ ok: true });
    expect(await guardedSend(await svc(), reminder, world({ customers: [cust({ marketing_consent: null, whatsapp_opt_in: null })] }).deps)).toMatchObject({ reason: "consent_unknown" });
  });
  it("blocked / archived / pseudonymised refused", async () => {
    for (const k of ["archived_at", "communication_blocked_at", "pseudonymized_at"] as const)
      expect(await guardedSend(await svc(), reminder, world({ customers: [cust({ [k]: "2026-01-01" })] }).deps)).toMatchObject({ reason: "customer_communication_blocked" });
  });
});

describe("Kept from 8B: recipient, tenant, roles, test mode", () => {
  it("test without customer / to arbitrary number refused", async () => {
    const u = await user(OWNER_A);
    expect(await guardedSend(u, { message: "t", test: true, to: "+31600000000", action_id: randomUUID() }, world().deps)).toMatchObject({ reason: "recipient_unverified" });
    expect(await guardedSend(u, manual({ test: true, to: "+31699999999" }), world().deps)).toMatchObject({ reason: "phone_mismatch" });
    expect(await guardedSend(u, manual({ kind: "test" }), world().deps)).toMatchObject({ reason: "test_kind_requires_test_flag" });
  });
  it("cross-tenant customer / appointment / body tenant refused", async () => {
    const u = await user(ADMIN_A);
    expect(await guardedSend(u, manual({ customer_id: CB }), world().deps)).toMatchObject({ status: 403 });
    expect(await guardedSend(u, manual({ customer_id: undefined, appointment_id: APPT_B }), world().deps)).toMatchObject({ reason: "customer_not_in_tenant" });
    expect(await guardedSend(u, manual({ user_id: SB }), world().deps)).toMatchObject({ reason: "body_tenant_mismatch" });
    expect(await guardedSend(await svc(), { ...reminder, user_id: SB }, world().deps)).toMatchObject({ reason: "body_tenant_mismatch" });
    expect(await guardedSend(await svc(), { ...reminder, appointment_id: APPT_NOCUST, event_ref: `appointment:${APPT_NOCUST}:24h` }, world().deps)).toMatchObject({ reason: "recipient_unverified" });
  });
  it("medewerker / financieel cannot send; service may not use test", async () => {
    for (const u of [EMP_A, FIN_A]) expect(await guardedSend(await user(u), manual(), world().deps)).toMatchObject({ reason: "role_not_allowed" });
    expect(await guardedSend(await svc(), { ...reminder, test: true }, world().deps)).toMatchObject({ reason: "test_not_allowed_for_service" });
  });
  it("demo tenant: simulated, no provider call", async () => {
    const w = world({ demo: true });
    expect(await guardedSend(await user(OWNER_A), manual({ test: true }), w.deps)).toMatchObject({ result: "simulated" });
    expect(w.transport).not.toHaveBeenCalled();
  });
  it("log has masked phone and keyed fingerprints only", async () => {
    const w = world();
    await guardedSend(await user(ADMIN_A), manual({ message: "Ja https://x.test/a/tok123" }), w.deps);
    const log = JSON.stringify(w.finalize.mock.calls[0][3]);
    expect(log).not.toMatch(/612345678|tok123|test-only-fictitious-key|"message"/);
    expect(log).toContain("+31****78");
    expect(log).not.toContain(createHash("sha256").update("Ja https://x.test/a/tok123").digest("hex"));
  });
});

describe("Stays inactive", () => {
  it("no active edge function imports inactive modules", () => {
    const off: string[] = [];
    const walk = (dir: string) => { for (const f of readdirSync(dir)) { const p = join(dir, f);
      if (p.includes("/inactive")) continue;
      if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts") && /inactive\//.test(readFileSync(p, "utf8"))) off.push(p); } };
    walk("supabase/functions");
    expect(off).toEqual([]);
  });
  it("guard has no network/env/db access", () => {
    expect(readFileSync("supabase/functions/_shared/inactive/whatsappSendGuard.ts", "utf8")).not.toMatch(/\bfetch\(|Deno\.env|createClient/);
  });
});
