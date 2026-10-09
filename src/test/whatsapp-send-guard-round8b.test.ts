// Round 8B (supersedes the 8A guard tests). Fictitious data, fully mocked deps.
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";
import {
  guardedSend, verifyServiceRequest, type Deps, type CustomerRow, type ClaimState, type Identity, type ServiceVerifyDeps,
} from "../../supabase/functions/_shared/inactive/whatsappSendGuard";

const SA = "11111111-1111-1111-1111-111111111111", SB = "22222222-2222-2222-2222-222222222222";
const OWNER_A = SA, ADMIN_A = "a0000000-0000-0000-0000-00000000000a", EMP_A = "a0000000-0000-0000-0000-00000000000c";
const FIN_A = "a0000000-0000-0000-0000-00000000000f";
const CA = "c0000000-0000-0000-0000-0000000000a1", CB = "c0000000-0000-0000-0000-0000000000b1";
const APPT_A = "d0000000-0000-0000-0000-0000000000a1", APPT_B = "d0000000-0000-0000-0000-0000000000b1";
const APPT_NOCUST = "d0000000-0000-0000-0000-0000000000a2";

const cust = (o: Partial<CustomerRow> = {}): CustomerRow => ({ id: CA, user_id: SA, phone: "0612345678",
  whatsapp_opt_in: true, marketing_consent: true, archived_at: null, pseudonymized_at: null, communication_blocked_at: null, ...o });

function world(o: { customers?: CustomerRow[]; stopped?: string[]; prefOut?: string[]; transport?: Deps["transport"];
  finalizeFails?: boolean; demo?: boolean; slowClaim?: boolean } = {}) {
  const customers = new Map((o.customers ?? [cust(), cust({ id: CB, user_id: SB, phone: "+31612345679" })]).map((c) => [c.id, c]));
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
    preferenceWhatsappOptOut: async (_t, c) => (o.prefOut ?? []).includes(c),
    isStopped: async (t, p) => (o.stopped ?? []).includes(`${t}:${p}`),
    whatsappEnabled: async () => true,
    isDemoTenant: async () => !!o.demo,
    claim: async (t, k, fp) => {
      if (o.slowClaim) await new Promise((r) => setTimeout(r, 5));
      const e = claims.get(`${t}|${k}`);            // simulated atomic INSERT ... ON CONFLICT
      if (e) return { created: false, state: e.state, fingerprint: e.fp };
      claims.set(`${t}|${k}`, { state: "claimed", fp }); return { created: true };
    },
    finalize, transport,
    hmac: async (p, v) => createHmac("sha256", "test-only-fictitious-key").update(`${p}|${v}`).digest("hex"),
  };
  return { deps, transport, finalize, claims };
}
const user = (u: string): Identity => ({ kind: "user", userId: u });
const svc = (caller: "reminder-scheduler" | "auto-rebook" | "automation-scheduler" = "reminder-scheduler"): Identity => ({ kind: "service", caller });
const reminder = { message: "Herinnering", kind: "reminder", appointment_id: APPT_A, reminder_type: "24h" };
const manual = { message: "Hallo", kind: "manual", customer_id: CA };

describe("A. recipient is always a verified customer", () => {
  it("test message without customer -> refused", async () => {
    const w = world();
    expect(await guardedSend(user(OWNER_A), { message: "t", test: true, to: "+31600000000" }, w.deps)).toMatchObject({ status: 422, reason: "recipient_unverified" });
    expect(w.transport).not.toHaveBeenCalled();
  });
  it("test message to an arbitrary number (customer given) -> phone_mismatch", async () => {
    expect(await guardedSend(user(OWNER_A), { ...manual, test: true, to: "+31699999999" }, world().deps)).toMatchObject({ status: 422, reason: "phone_mismatch" });
  });
  it("service call with only appointment id resolves the customer and checks consent", async () => {
    const w = world({ customers: [cust({ whatsapp_opt_in: null })] });
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ status: 409, reason: "consent_unknown" });
    expect(await guardedSend(svc(), reminder, world().deps)).toMatchObject({ ok: true });
  });
  it("appointment without customer -> refused", async () => {
    expect(await guardedSend(svc(), { ...reminder, appointment_id: APPT_NOCUST }, world().deps)).toMatchObject({ status: 422, reason: "recipient_unverified" });
  });
  it("appointment of another salon -> refused", async () => {
    expect(await guardedSend(user(ADMIN_A), { ...manual, appointment_id: APPT_B }, world().deps)).toMatchObject({ status: 403 });
    expect(await guardedSend(user(ADMIN_A), { message: "x", kind: "manual", appointment_id: APPT_B }, world().deps)).toMatchObject({ status: 403, reason: "customer_not_in_tenant" });
  });
  it("customer of another salon -> refused, also for test", async () => {
    expect(await guardedSend(user(OWNER_A), { ...manual, test: true, customer_id: CB }, world().deps)).toMatchObject({ status: 403 });
  });
  it("test does not bypass STOP or consent; demo still enforces roles", async () => {
    expect(await guardedSend(user(OWNER_A), { ...manual, test: true }, world({ stopped: [`${SA}:+31612345678`] }).deps)).toMatchObject({ reason: "customer_stopped" });
    expect(await guardedSend(user(OWNER_A), { ...manual, test: true }, world({ customers: [cust({ whatsapp_opt_in: null })] }).deps)).toMatchObject({ reason: "consent_unknown" });
    const w = world({ demo: true });
    expect(await guardedSend(user(EMP_A), { ...manual, test: true }, w.deps)).toMatchObject({ status: 403 });
    expect(await guardedSend(user(OWNER_A), { ...manual, test: true }, w.deps)).toMatchObject({ result: "simulated" });
    expect(w.transport).not.toHaveBeenCalled();
  });
  it("service may not use test", async () => {
    expect(await guardedSend(svc(), { ...reminder, test: true }, world().deps)).toMatchObject({ reason: "test_not_allowed_for_service" });
  });
  it("anonymous and forged body tenant", async () => {
    expect(await guardedSend({ kind: "anonymous" }, manual, world().deps)).toMatchObject({ status: 401 });
    expect(await guardedSend(user(ADMIN_A), { ...manual, user_id: SB }, world().deps)).toMatchObject({ reason: "body_tenant_mismatch" });
    expect(await guardedSend(svc(), { ...reminder, user_id: SB }, world().deps)).toMatchObject({ reason: "body_tenant_mismatch" });
  });
  it("medewerker / financieel cannot send", async () => {
    for (const u of [EMP_A, FIN_A]) expect(await guardedSend(user(u), manual, world().deps)).toMatchObject({ reason: "role_not_allowed" });
  });
});

describe("B. consent model (existing columns)", () => {
  it("missing consent -> refused", async () => {
    expect(await guardedSend(svc(), reminder, world({ customers: [cust({ whatsapp_opt_in: null })] }).deps)).toMatchObject({ reason: "consent_unknown" });
  });
  it("STOP via customer_message_preferences.whatsapp_opt_out", async () => {
    expect(await guardedSend(svc(), reminder, world({ prefOut: [CA] }).deps)).toMatchObject({ reason: "preference_opted_out" });
  });
  it("salon STOP wins over explicit opt-in", async () => {
    expect(await guardedSend(svc(), reminder, world({ stopped: [`${SA}:+31612345678`] }).deps)).toMatchObject({ reason: "customer_stopped" });
  });
  it("marketing without marketing_consent -> refused", async () => {
    const w = world({ customers: [cust({ marketing_consent: null })] });
    expect(await guardedSend(svc("auto-rebook"), { ...reminder, kind: "rebook" }, w.deps)).toMatchObject({ reason: "marketing_consent_missing" });
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ ok: true }); // transactional reminder ok
  });
  it("manual message with unknown purpose -> refused", async () => {
    expect(await guardedSend(user(ADMIN_A), { ...manual, kind: "whatever" }, world().deps)).toMatchObject({ status: 422, reason: "purpose_unknown" });
    expect(await guardedSend(user(ADMIN_A), { ...manual, kind: undefined }, world().deps)).toMatchObject({ reason: "purpose_unknown" });
  });
  it("manual message needs marketing-level consent (purpose not verifiable)", async () => {
    expect(await guardedSend(user(ADMIN_A), manual, world({ customers: [cust({ marketing_consent: false })] }).deps)).toMatchObject({ reason: "marketing_consent_missing" });
  });
  it("blocked / archived / pseudonymised refused", async () => {
    for (const k of ["archived_at", "communication_blocked_at", "pseudonymized_at"] as const)
      expect(await guardedSend(svc(), reminder, world({ customers: [cust({ [k]: "2026-01-01" })] }).deps)).toMatchObject({ reason: "customer_communication_blocked" });
  });
});

describe("C. phone numbers", () => {
  it("0612345678 and +31612345678 are the same recipient", async () => {
    const w = world();
    expect(await guardedSend(user(ADMIN_A), { ...manual, to: "+31612345678" }, w.deps)).toMatchObject({ ok: true });
    expect(w.transport.mock.calls[0][0]).toBe("+31612345678");
    expect(await guardedSend(user(ADMIN_A), { ...manual, to: "06-1234 5678", message: "b" }, world().deps)).toMatchObject({ ok: true });
  });
  it("invalid or ambiguous numbers refused", async () => {
    for (const to of ["612345678", "+31 6 1234", "06123456789", "+3106123", "abc"])
      expect(await guardedSend(user(ADMIN_A), { ...manual, to }, world().deps)).toMatchObject({ status: 422 });
    expect(await guardedSend(svc(), reminder, world({ customers: [cust({ phone: "6123" })] }).deps)).toMatchObject({ reason: "customer_phone_invalid" });
  });
});

describe("D. service caller authentication", () => {
  const key = new Uint8Array(32).fill(7);
  const mk = (over: Partial<ServiceVerifyDeps> = {}): ServiceVerifyDeps => {
    const seen = new Set<string>();
    return { keys: { "reminder-scheduler": key }, now: () => 1_800_000_000_000,
      hmacHex: async (k, m) => createHmac("sha256", Buffer.from(k)).update(m).digest("hex"),
      sha256Hex: async (m) => createHash("sha256").update(m).digest("hex"),
      rememberNonce: async (c, n) => (seen.has(c + n) ? false : (seen.add(c + n), true)), ...over };
  };
  const sign = (caller: string, body: string, k = key, ts = "1800000000", nonce = "ab".repeat(16)) => ({
    caller, ts, nonce, sig: createHmac("sha256", Buffer.from(k)).update(`wa-send:v1|${caller}|${ts}|${nonce}|${createHash("sha256").update(body).digest("hex")}`).digest("hex") });
  const body = JSON.stringify(reminder);
  it("valid signature -> service identity", async () => {
    expect(await verifyServiceRequest(sign("reminder-scheduler", body), body, mk())).toMatchObject({ ok: true });
  });
  it("forged caller name without valid signature -> refused", async () => {
    expect(await verifyServiceRequest({ caller: "reminder-scheduler", ts: "1800000000", nonce: "ab".repeat(16), sig: "0".repeat(64) }, body, mk())).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(await verifyServiceRequest(sign("reminder-scheduler", body, new Uint8Array(32).fill(9)), body, mk())).toMatchObject({ ok: false });
  });
  it("caller signing as another caller with its own key -> refused", async () => {
    expect(await verifyServiceRequest(sign("auto-rebook", body), body, mk())).toMatchObject({ ok: false, reason: "caller_key_missing" });
  });
  it("unknown caller, tampered body, stale, replay, no keys -> refused", async () => {
    expect(await verifyServiceRequest(sign("evil", body), body, mk())).toMatchObject({ reason: "unknown_caller" });
    expect(await verifyServiceRequest(sign("reminder-scheduler", body), body + " ", mk())).toMatchObject({ reason: "bad_signature" });
    expect(await verifyServiceRequest(sign("reminder-scheduler", body, key, "1799999000"), body, mk())).toMatchObject({ reason: "stale_timestamp" });
    const d = mk(); const h = sign("reminder-scheduler", body);
    await verifyServiceRequest(h, body, d);
    expect(await verifyServiceRequest(h, body, d)).toMatchObject({ reason: "replay" });
    expect(await verifyServiceRequest(h, body, mk({ keys: null }))).toMatchObject({ reason: "service_auth_not_configured" });
  });
  it("verified caller limited to its own kinds", async () => {
    expect(await guardedSend(svc(), { ...reminder, kind: "campaign" }, world().deps)).toMatchObject({ reason: "kind_not_allowed_for_caller" });
    expect(await guardedSend(svc("automation-scheduler"), { ...reminder, kind: "reminder" }, world().deps)).toMatchObject({ reason: "kind_not_allowed_for_caller" });
  });
});

describe("E. idempotency", () => {
  const k = { idempotency_key: "camp-2026-10-001" };
  it("same key, other recipient -> conflict", async () => {
    const w = world({ customers: [cust(), cust({ id: "c0000000-0000-0000-0000-0000000000a9", phone: "+31612345670" })] });
    await guardedSend(user(ADMIN_A), { ...manual, ...k }, w.deps);
    expect(await guardedSend(user(ADMIN_A), { ...manual, ...k, customer_id: "c0000000-0000-0000-0000-0000000000a9" }, w.deps)).toMatchObject({ reason: "idempotency_conflict" });
    expect(w.transport).toHaveBeenCalledTimes(1);
  });
  it("same key, other content -> conflict", async () => {
    const w = world();
    await guardedSend(user(ADMIN_A), { ...manual, ...k }, w.deps);
    expect(await guardedSend(user(ADMIN_A), { ...manual, ...k, message: "Anders" }, w.deps)).toMatchObject({ reason: "idempotency_conflict" });
  });
  it("same appointment reminder with changed content -> conflict, not a new send", async () => {
    const w = world();
    await guardedSend(svc(), reminder, w.deps);
    expect(await guardedSend(svc(), { ...reminder, message: "Andere tekst" }, w.deps)).toMatchObject({ reason: "idempotency_conflict" });
    expect(await guardedSend(svc(), { ...reminder, reminder_type: "2h" }, w.deps)).toMatchObject({ ok: true });
    expect(w.transport).toHaveBeenCalledTimes(2);
  });
  it("concurrent identical requests -> one provider call", async () => {
    const w = world({ slowClaim: true });
    const rs = await Promise.all([1, 2, 3].map(() => guardedSend(svc(), reminder, w.deps)));
    expect(w.transport).toHaveBeenCalledTimes(1);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
  });
  it("identical retry after success -> duplicate", async () => {
    const w = world(); await guardedSend(svc(), reminder, w.deps);
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ reason: "duplicate" });
  });
  it("uncertain provider outcome -> never resent", async () => {
    const w = world({ transport: async () => { throw new Error("timeout"); } });
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ reason: "outcome_unknown" });
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ reason: "outcome_unknown" });
    expect(w.transport).toHaveBeenCalledTimes(1);
  });
  it("logging fails after provider accepted -> no second send", async () => {
    const w = world({ finalizeFails: true });
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ ok: true });
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ reason: "outcome_unknown" });
    expect(w.transport).toHaveBeenCalledTimes(1);
  });
  it("validation error before send -> no claim", async () => {
    const w = world(); await guardedSend(user(ADMIN_A), { ...manual, to: "nope" }, w.deps);
    expect(w.claims.size).toBe(0);
  });
});

describe("Privacy", () => {
  it("log has masked phone and keyed fingerprints only", async () => {
    const w = world();
    await guardedSend(user(ADMIN_A), { ...manual, message: "Ja https://x.test/a/tok123" }, w.deps);
    const log = JSON.stringify(w.finalize.mock.calls[0][3]);
    expect(log).not.toMatch(/612345678|tok123|test-only-fictitious-key|"message"/);
    expect(log).toContain("+31****78");
    // fingerprint is keyed: not equal to a plain sha256 of the text
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
