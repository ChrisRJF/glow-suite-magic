// Round 8D: business-event verification + Gateway STOP adapter. Fictitious data, mocks only.
import { describe, it, expect, vi } from "vitest";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  guardedSend, verifyServiceRequest, signingString, SEND_PATH,
  type Deps, type CustomerRow, type ClaimState, type ServiceCaller, type ServiceKeyConfig,
} from "../../supabase/functions/_shared/inactive/whatsappSendGuard";
import { type EventRow } from "../../supabase/functions/_shared/inactive/eventVerifier";
import { makeGatewayIsStopped, StopCheckBlocked, type StopAdapterDeps } from "../../supabase/functions/_shared/inactive/gatewayStopAdapter";

const SA = "11111111-1111-1111-1111-111111111111", SB = "22222222-2222-2222-2222-222222222222";
const CA = "c0000000-0000-0000-0000-0000000000a1", CB = "c0000000-0000-0000-0000-0000000000b1", CA2 = "c0000000-0000-0000-0000-0000000000a9";
const AP = "d0000000-0000-0000-0000-0000000000a1", AP_B = "d0000000-0000-0000-0000-0000000000b1", AP_X = "d0000000-0000-0000-0000-0000000000ff";
const RUN = "e0000000-0000-0000-0000-000000000001", REB = "e0000000-0000-0000-0000-000000000002", FRM = "e0000000-0000-0000-0000-000000000003";
const NOW = 1_800_000_000_000, H = 3600e3;

const cust = (o: Partial<CustomerRow> = {}): CustomerRow => ({ id: CA, user_id: SA, phone: "+31612345678", whatsapp_opt_in: true,
  marketing_consent: true, archived_at: null, pseudonymized_at: null, communication_blocked_at: null, ...o });

function world(events: EventRow[], o: { now?: number; resolve?: Deps["resolveEvent"]; isStopped?: Deps["isStopped"] } = {}) {
  const customers = new Map([cust(), cust({ id: CB, user_id: SB, phone: "+31612345679" }), cust({ id: CA2, phone: "+31612345670" })].map((c) => [c.id, c]));
  const claims = new Map<string, { state: ClaimState; fp: string }>();
  const transport = vi.fn(async () => ({ accepted: true, sid: "SM_fake" }));
  const ev = new Map(events.map((e) => [`${e.type}:${e.id}`, e]));
  const deps: Deps = {
    tenantOfUser: async () => null, roleInTenant: async () => null,
    customer: async (id) => customers.get(id) ?? null,
    appointment: async (id) => ({ [AP]: { user_id: SA, customer_id: CA }, [AP_B]: { user_id: SB, customer_id: CB },
      [AP_X]: { user_id: SA, customer_id: CA } } as Record<string, { user_id: string; customer_id: string }>)[id] ?? null,
    preferenceWhatsappOptOut: async () => null,
    isStopped: o.isStopped ?? (async () => false),
    whatsappEnabled: async () => true, isDemoTenant: async () => false, sendingPaused: async () => false,
    claim: async (t, k, fp) => { await new Promise((r) => setTimeout(r, 3)); const e = claims.get(`${t}|${k}`);
      if (e) return { created: false, state: e.state, fingerprint: e.fp }; claims.set(`${t}|${k}`, { state: "claimed", fp }); return { created: true }; },
    finalize: async (t, k, s) => { claims.set(`${t}|${k}`, { ...claims.get(`${t}|${k}`)!, state: s }); },
    transport,
    hmac: async (p, v) => createHmac("sha256", "fict").update(`${p}|${v}`).digest("hex"),
    now: () => o.now ?? NOW,
    resolveEvent: o.resolve ?? (async (t, id) => ev.get(`${t}:${id}`) ?? null),
  };
  return { deps, transport, claims };
}

const KEY = new Uint8Array(32).fill(7);
const ALL: ServiceCaller[] = ["reminder-scheduler", "automation-scheduler", "auto-rebook", "booking-confirmation", "payment-webhook", "customer-forms"];
async function svc(caller: ServiceCaller) {
  const nonce = createHash("md5").update(randomUUID()).digest("hex");
  const msg = signingString("POST", SEND_PATH, caller, "1", "1800000000", nonce, createHash("sha256").update("{}").digest("hex"));
  const r = await verifyServiceRequest({ method: "POST", path: SEND_PATH, rawBody: "{}", headers: { caller, keyId: "1", ts: "1800000000", nonce,
    sig: createHmac("sha256", Buffer.from(KEY)).update(msg).digest("hex") } }, {
    keys: Object.fromEntries(ALL.map((c) => [c, { current: "1", keys: { "1": KEY } }])) as ServiceKeyConfig, now: () => NOW,
    hmacHex: async (k, m) => createHmac("sha256", Buffer.from(k)).update(m).digest("hex"),
    sha256Hex: async (m) => createHash("sha256").update(m).digest("hex"), rememberNonce: async () => true });
  if (r.ok === false) throw new Error(r.reason); return r.identity;
}

const appt = (o: Partial<Extract<EventRow, { type: "appointment" }>> = {}): EventRow =>
  ({ type: "appointment", id: AP, user_id: SA, customer_id: CA, status: "gepland", starts_at_ms: NOW + 24 * H, ...o });
const rem = (slot = "24h", id = AP) => ({ message: "Herinnering", kind: "reminder", appointment_id: id, event_ref: `appointment:${id}:${slot}` });

describe("8D-B business events: appointment reminders", () => {
  it("existing appointment, right salon/customer, inside 24h window -> sent", async () => {
    const w = world([appt()]);
    expect(await guardedSend(await svc("reminder-scheduler"), rem(), w.deps)).toMatchObject({ ok: true });
  });
  it("non-existent appointment row (event missing) -> 403, no provider", async () => {
    const w = world([]);
    expect(await guardedSend(await svc("reminder-scheduler"), rem(), w.deps)).toMatchObject({ status: 403, reason: "event_not_found" });
    expect(w.transport).not.toHaveBeenCalled(); expect(w.claims.size).toBe(0);
  });
  it("event row of another salon -> 403", async () => {
    const w = world([appt({ user_id: SB })]);
    expect(await guardedSend(await svc("reminder-scheduler"), rem(), w.deps)).toMatchObject({ status: 403, reason: "event_not_in_tenant" });
    expect(w.transport).not.toHaveBeenCalled();
  });
  it("event row of another customer -> 403", async () => {
    const w = world([appt({ customer_id: CA2 })]);
    expect(await guardedSend(await svc("reminder-scheduler"), rem(), w.deps)).toMatchObject({ status: 403, reason: "event_customer_mismatch" });
    expect(w.transport).not.toHaveBeenCalled();
  });
  it("invalid reminder slot -> 422", async () => {
    for (const s of ["1h", "48h", "reminder"]) {
      const w = world([appt()]);
      expect(await guardedSend(await svc("reminder-scheduler"), rem(s), w.deps)).toMatchObject({ status: 422, reason: "invalid_reminder_slot" });
      expect(w.transport).not.toHaveBeenCalled();
    }
  });
  it("wrong reminder moment -> refused (24h too late, 2h too early, past appointment)", async () => {
    const s = await svc("reminder-scheduler");
    expect(await guardedSend(s, rem("24h"), world([appt({ starts_at_ms: NOW + H })]).deps)).toMatchObject({ reason: "reminder_outside_window" });
    expect(await guardedSend(s, rem("2h"), world([appt()]).deps)).toMatchObject({ reason: "reminder_outside_window" });
    expect(await guardedSend(s, rem("2h"), world([appt({ starts_at_ms: NOW - H })]).deps)).toMatchObject({ reason: "reminder_outside_window" });
    expect(await guardedSend(s, rem("2h"), world([appt({ starts_at_ms: NOW + H })]).deps)).toMatchObject({ ok: true });
    expect(await guardedSend(s, rem("24h"), world([appt({ starts_at_ms: null })]).deps)).toMatchObject({ reason: "event_time_unknown" });
  });
  it("cancelled appointment -> no reminder / confirmation", async () => {
    const w = world([appt({ status: "geannuleerd" })]);
    expect(await guardedSend(await svc("reminder-scheduler"), rem(), w.deps)).toMatchObject({ status: 409, reason: "event_cancelled" });
    expect(await guardedSend(await svc("booking-confirmation"), { message: "x", kind: "confirmation", appointment_id: AP, event_ref: `appointment:${AP}` }, w.deps))
      .toMatchObject({ reason: "event_cancelled" });
  });
  it("database error / malformed row during event check -> 503, no claim, no provider", async () => {
    for (const resolve of [async () => { throw new Error("down"); }, async () => ({ type: "appointment" } as never), async () => "yes" as never]) {
      const w = world([], { resolve });
      expect(await guardedSend(await svc("reminder-scheduler"), rem(), w.deps)).toMatchObject({ status: 503, reason: "event_lookup_failed" });
      expect(w.claims.size).toBe(0); expect(w.transport).not.toHaveBeenCalled();
    }
  });
  it("resolver returning a different id is refused (never trust the ref alone)", async () => {
    const w = world([], { resolve: async () => appt({ id: AP_X }) });
    expect(await guardedSend(await svc("reminder-scheduler"), rem(), w.deps)).toMatchObject({ status: 503 });
  });
  it("duplicate protection kept: same event twice and concurrently -> one provider call", async () => {
    const w = world([appt()]); const s = await svc("reminder-scheduler");
    const rs = await Promise.all([1, 2, 3].map(() => guardedSend(s, rem(), w.deps)));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await guardedSend(s, rem(), w.deps)).toMatchObject({ reason: "duplicate" });
    expect(w.transport).toHaveBeenCalledTimes(1);
  });
});

describe("8D-B business events: runs, rebook actions, forms", () => {
  const run = (o = {}): EventRow => ({ type: "automation_run", id: RUN, user_id: SA, customer_id: CA, appointment_id: null, status: "scheduled", ...o });
  const reb = (o = {}): EventRow => ({ type: "rebook_action", id: REB, user_id: SA, customer_id: CA, appointment_id: null, reversed_at: null, ...o });
  const frm = (o = {}): EventRow => ({ type: "form_request", id: FRM, user_id: SA, customer_id: CA, appointment_id: null, status: "sent", completed_at: null, expires_at_ms: NOW + 48 * H, ...o });
  const A = { message: "x", kind: "automation", customer_id: CA, event_ref: `automation_run:${RUN}` };
  const R = { message: "x", kind: "auto_rebook", customer_id: CA, event_ref: `rebook_action:${REB}` };
  const F = { message: "x", kind: "form_request", customer_id: CA, event_ref: `form_request:${FRM}` };

  it("automation run: ok / other salon / other customer / skipped / missing", async () => {
    const s = await svc("automation-scheduler");
    expect(await guardedSend(s, A, world([run()]).deps)).toMatchObject({ ok: true });
    expect(await guardedSend(s, A, world([run({ user_id: SB })]).deps)).toMatchObject({ reason: "event_not_in_tenant" });
    expect(await guardedSend(s, A, world([run({ customer_id: CA2 })]).deps)).toMatchObject({ reason: "event_customer_mismatch" });
    expect(await guardedSend(s, A, world([run({ status: "skipped" })]).deps)).toMatchObject({ reason: "event_not_active" });
    expect(await guardedSend(s, A, world([]).deps)).toMatchObject({ reason: "event_not_found" });
  });
  it("event linked to another appointment than requested -> 403", async () => {
    const s = await svc("automation-scheduler");
    expect(await guardedSend(s, { ...A, appointment_id: AP }, world([run({ appointment_id: AP_X })]).deps)).toMatchObject({ reason: "event_appointment_mismatch" });
  });
  it("rebook action: ok / reversed / other customer", async () => {
    const s = await svc("auto-rebook");
    expect(await guardedSend(s, R, world([reb()]).deps)).toMatchObject({ ok: true });
    expect(await guardedSend(s, R, world([reb({ reversed_at: "2026-10-01T00:00:00Z" })]).deps)).toMatchObject({ reason: "event_not_active" });
    expect(await guardedSend(s, R, world([reb({ customer_id: CB })]).deps)).toMatchObject({ reason: "event_customer_mismatch" });
  });
  it("form request: ok / completed / expired / bad slot", async () => {
    const s = await svc("customer-forms");
    expect(await guardedSend(s, F, world([frm()]).deps)).toMatchObject({ ok: true });
    expect(await guardedSend(s, F, world([frm({ completed_at: "2026-10-01T00:00:00Z" })]).deps)).toMatchObject({ reason: "event_not_active" });
    expect(await guardedSend(s, F, world([frm({ expires_at_ms: NOW - 1 })]).deps)).toMatchObject({ reason: "event_expired" });
    expect(await guardedSend(s, { ...F, kind: "form_reminder", event_ref: `form_request:${FRM}:reminder` }, world([frm()]).deps)).toMatchObject({ ok: true });
    expect(await guardedSend(s, { ...F, kind: "form_reminder", event_ref: `form_request:${FRM}:2h` }, world([frm()]).deps)).toMatchObject({ reason: "invalid_reminder_slot" });
  });
});

// ---- 8D-C Gateway STOP adapter ---------------------------------------------
const K1 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const K2 = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=";
const RING = JSON.stringify({ current: "2", keys: { "1": K1, "2": K2 } });
// Fixed vectors from round 6 (unchanged).
const V1 = "c1.1.54d32dc70c302bac4fa8614b919383d124e6cba859dc9ec71ea94a9c670bf5d1"; // tenant-test-a, v1
const V2 = "c1.1.4e10fd1b1755ec739ef10871d4dcf72672dff79a38bf256474929031c6fc9a0a"; // tenant-test-b, v1
const V4 = "c1.2.9598b313a9e4816146b5fa231d75e09a6d85991e81eff57e37092583bb53b06e"; // tenant-test-a, v2
const link = (salon: string, tenant: string, o = {}) => ({ tenant_id: tenant, salon_id: salon, enabled: true, allowed_action_types: ["opt_out_signal"], ...o });

function stopDb(o: Partial<StopAdapterDeps> & { stops?: Record<string, string[]> } = {}) {
  const links: Record<string, ReturnType<typeof link>> = { [SA]: link(SA, "tenant-test-a"), [SB]: link(SB, "tenant-test-b") };
  const seen: { salon: string; refs: string[] }[] = [];
  const deps: StopAdapterDeps = {
    linkForSalon: async (s) => links[s] ?? null, contactRefConfig: RING,
    rpc: async (_f, a) => { seen.push({ salon: a._salon, refs: a._refs });
      return { data: (o.stops?.[a._salon] ?? []).some((r) => a._refs.includes(r)), error: null }; },
    ...o,
  };
  return { isStopped: makeGatewayIsStopped(deps), seen };
}
const reason = async (p: Promise<unknown>) => { try { await p; return "no_throw"; } catch (e) { return e instanceof StopCheckBlocked ? e.reason : "other"; } };

describe("8D-C STOP adapter", () => {
  it("computes refs under all key versions with the Gateway tenant id (fixed vectors)", async () => {
    const d = stopDb();
    expect(await d.isStopped(SA, "+31612345678")).toBe(false);
    expect(d.seen[0].salon).toBe(SA);
    expect(new Set(d.seen[0].refs)).toEqual(new Set([V1, V4]));
  });
  it("STOP stored under the OLD key version still blocks after rotation", async () => {
    expect(await stopDb({ stops: { [SA]: [V1] } }).isStopped(SA, "0612345678")).toBe(true);
    expect(await stopDb({ stops: { [SA]: [V4] } }).isStopped(SA, "+31 6 12345678")).toBe(true);
  });
  it("salon A never uses salon B STOP data", async () => {
    const d = stopDb({ stops: { [SB]: [V2, V1] } });
    expect(await d.isStopped(SA, "+31612345678")).toBe(false);
    expect(d.seen.every((x) => x.salon === SA)).toBe(true);
    expect(await d.isStopped(SB, "+31612345678")).toBe(true);
  });
  it("missing / disabled / foreign / salon-id-as-tenant mapping -> blocked", async () => {
    expect(await reason(stopDb({ linkForSalon: async () => null }).isStopped(SA, "+31612345678"))).toBe("tenant_not_mapped");
    expect(await reason(stopDb({ linkForSalon: async () => link(SA, "t", { enabled: false }) }).isStopped(SA, "+31612345678"))).toBe("tenant_link_disabled");
    expect(await reason(stopDb({ linkForSalon: async () => link(SB, "t") }).isStopped(SA, "+31612345678"))).toBe("tenant_link_mismatch");
    expect(await reason(stopDb({ linkForSalon: async () => link(SA, SA) }).isStopped(SA, "+31612345678"))).toBe("tenant_id_is_salon_id");
    expect(await reason(stopDb({ linkForSalon: async () => link(SA, "t", { allowed_action_types: [] }) }).isStopped(SA, "+31612345678"))).toBe("tenant_link_without_stop");
    expect(await reason(stopDb({ linkForSalon: async () => { throw new Error("down"); } }).isStopped(SA, "+31612345678"))).toBe("tenant_link_lookup_failed");
  });
  it("missing or invalid HMAC configuration -> blocked, no DB query", async () => {
    for (const cfg of [null, "", "{}", "not json", JSON.stringify({ current: "1", keys: { "1": "c2hvcnQ=" } }),
      JSON.stringify({ current: "3", keys: { "1": K1 } }), JSON.stringify({ current: "1", keys: { "1": K1, "BAD!": K2 } })]) {
      const d = stopDb({ contactRefConfig: cfg });
      expect(await reason(d.isStopped(SA, "+31612345678"))).toMatch(/^contact_ref_config_/);
      expect(d.seen).toHaveLength(0);
    }
  });
  it("STOP schema not applied is never an empty STOP list", async () => {
    for (const code of ["42P01", "42883", "PGRST202"])
      expect(await reason(stopDb({ rpc: async () => ({ data: null, error: { code } }) }).isStopped(SA, "+31612345678"))).toBe("stop_schema_missing");
  });
  it("unreachable DB / other error / unexpected value -> blocked", async () => {
    expect(await reason(stopDb({ rpc: async () => { throw new Error("ECONNREFUSED"); } }).isStopped(SA, "+31612345678"))).toBe("stop_db_unreachable");
    expect(await reason(stopDb({ rpc: async () => ({ data: null, error: { code: "57014" } }) }).isStopped(SA, "+31612345678"))).toBe("stop_db_error");
    for (const data of [null, "false", 0, [], {}])
      expect(await reason(stopDb({ rpc: async () => ({ data, error: null }) }).isStopped(SA, "+31612345678"))).toBe("stop_db_unexpected");
  });
  it("non-normalisable number -> blocked", async () => {
    expect(await reason(stopDb().isStopped(SA, "050 1234567"))).toBe("number_not_normalisable");
  });
  it("wired into the guard: blocked/stopped -> no claim, no provider; preference opt-out still checked", async () => {
    const s = await svc("reminder-scheduler");
    const bad = world([appt()], { isStopped: stopDb({ rpc: async () => ({ data: null, error: { code: "42P01" } }) }).isStopped });
    expect(await guardedSend(s, rem(), bad.deps)).toMatchObject({ status: 503, reason: "consent_lookup_failed" });
    expect(bad.transport).not.toHaveBeenCalled(); expect(bad.claims.size).toBe(0);
    const stopped = world([appt()], { isStopped: stopDb({ stops: { [SA]: [V1] } }).isStopped });
    expect(await guardedSend(s, rem(), stopped.deps)).toMatchObject({ status: 409, reason: "customer_stopped" });
    expect(stopped.transport).not.toHaveBeenCalled();
    const pref = world([appt()], { isStopped: stopDb().isStopped }); pref.deps.preferenceWhatsappOptOut = async () => true;
    expect(await guardedSend(s, rem(), pref.deps)).toMatchObject({ status: 409 });
    expect(pref.transport).not.toHaveBeenCalled();
    const ok = world([appt()], { isStopped: stopDb().isStopped });
    expect(await guardedSend(s, rem(), ok.deps)).toMatchObject({ ok: true });
  });
});

describe("8D stays inactive", () => {
  it("no active function imports the new modules", () => {
    const root = join(__dirname, "../../supabase/functions");
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f);
      return statSync(p).isDirectory() ? (f === "inactive" ? [] : walk(p)) : p.endsWith(".ts") ? [p] : []; });
    for (const f of walk(root)) expect(readFileSync(f, "utf8")).not.toMatch(/eventVerifier|gatewayStopAdapter|whatsappSendGuard/);
  });
});
