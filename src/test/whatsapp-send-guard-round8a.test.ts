import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { guardedSend, type Deps, type CustomerRow, type ClaimState, type Identity } from "../../supabase/functions/_shared/inactive/whatsappSendGuard";

// Fictitious tenants, users and customers only.
const SA = "11111111-1111-1111-1111-111111111111";
const SB = "22222222-2222-2222-2222-222222222222";
const OWNER_A = SA, ADMIN_A = "a0000000-0000-0000-0000-00000000000a", EMP_A = "a0000000-0000-0000-0000-00000000000c";
const FIN_A = "a0000000-0000-0000-0000-00000000000f", ADMIN_B = "b0000000-0000-0000-0000-00000000000a";
const CA = "c0000000-0000-0000-0000-0000000000a1", CB = "c0000000-0000-0000-0000-0000000000b1";
const APPT_A = "d0000000-0000-0000-0000-0000000000a1", APPT_B = "d0000000-0000-0000-0000-0000000000b1";
const PHONE_A = "+31600000001", PHONE_B = "+31600000002";

function cust(over: Partial<CustomerRow> = {}): CustomerRow {
  return { id: CA, user_id: SA, phone: PHONE_A, whatsapp_opt_in: true, marketing_opt_in: false,
    archived_at: null, pseudonymized_at: null, communication_blocked_at: null, ...over };
}

function world(opts: { customers?: CustomerRow[]; stopped?: string[]; transport?: Deps["transport"]; finalizeFails?: boolean; demo?: boolean } = {}) {
  const customers = new Map((opts.customers ?? [cust(), cust({ id: CB, user_id: SB, phone: PHONE_B })]).map((c) => [c.id, c]));
  const roles: Record<string, [string, string]> = {
    [OWNER_A]: [SA, "eigenaar"], [ADMIN_A]: [SA, "admin"], [EMP_A]: [SA, "medewerker"],
    [FIN_A]: [SA, "financieel"], [ADMIN_B]: [SB, "admin"],
  };
  const claims = new Map<string, ClaimState>();
  const transport = vi.fn(opts.transport ?? (async () => ({ accepted: true, sid: "SM_fake" })));
  const finalize = vi.fn(async (k: string, s: ClaimState) => { if (opts.finalizeFails) throw new Error("db down"); claims.set(k, s); });
  const deps: Deps = {
    roleInTenant: async (u, t) => (roles[u]?.[0] === t ? (roles[u][1] as never) : null),
    tenantOfUser: async (u) => roles[u]?.[0] ?? null,
    customer: async (id) => customers.get(id) ?? null,
    appointmentOwner: async (id) => (id === APPT_A ? { user_id: SA, customer_id: CA } : id === APPT_B ? { user_id: SB, customer_id: CB } : null),
    isStopped: async (t, p) => (opts.stopped ?? []).includes(`${t}:${p}`),
    whatsappEnabled: async () => true,
    isDemoTenant: async () => !!opts.demo,
    claim: async (k) => {
      // Synchronous check-and-set mirrors a unique-key insert.
      if (claims.has(k)) return { created: false, state: claims.get(k)! };
      claims.set(k, "claimed"); return { created: true };
    },
    finalize,
    transport,
    hash: async (s) => `h(${s})`,
  };
  return { deps, transport, finalize, claims };
}

const user = (userId: string): Identity => ({ kind: "user", userId });
const svc = (caller: "reminder-scheduler" | "auto-rebook" = "reminder-scheduler"): Identity => ({ kind: "service", caller });
const manual = { to: PHONE_A, message: "Hallo", kind: "manual", customer_id: CA };
const reminder = { to: PHONE_A, message: "Herinnering", kind: "reminder", customer_id: CA, appointment_id: APPT_A, reminder_type: "24h" };

describe("8A identity", () => {
  it("anonymous -> 401, no send", async () => {
    const w = world();
    expect(await guardedSend({ kind: "anonymous" }, manual, w.deps)).toMatchObject({ status: 401 });
    expect(w.transport).not.toHaveBeenCalled();
  });
  it("forged body user_id (other salon) -> 403", async () => {
    const w = world();
    expect(await guardedSend(user(ADMIN_A), { ...manual, user_id: SB }, w.deps)).toMatchObject({ status: 403, reason: "body_tenant_mismatch" });
  });
  it("user without membership -> 403", async () => {
    const w = world();
    expect(await guardedSend(user("e0000000-0000-0000-0000-000000000000"), manual, w.deps)).toMatchObject({ status: 403, reason: "no_tenant" });
  });
  it("tenant is derived from identity, not body", async () => {
    const w = world();
    expect(await guardedSend(user(ADMIN_A), manual, w.deps)).toMatchObject({ ok: true });
  });
});

describe("8A roles and tenant", () => {
  it("medewerker and financieel cannot send", async () => {
    for (const u of [EMP_A, FIN_A]) expect(await guardedSend(user(u), manual, world().deps)).toMatchObject({ status: 403, reason: "role_not_allowed" });
  });
  it("admin A cannot use customer of salon B", async () => {
    expect(await guardedSend(user(ADMIN_A), { ...manual, customer_id: CB, to: PHONE_B }, world().deps)).toMatchObject({ status: 403, reason: "customer_not_in_tenant" });
  });
  it("admin A cannot use appointment of salon B", async () => {
    expect(await guardedSend(user(ADMIN_A), { ...manual, appointment_id: APPT_B }, world().deps)).toMatchObject({ status: 403 });
  });
  it("phone must match the customer's phone", async () => {
    expect(await guardedSend(user(ADMIN_A), { ...manual, to: PHONE_B }, world().deps)).toMatchObject({ status: 422, reason: "phone_mismatch" });
  });
});

describe("8A test flag", () => {
  it("test=true denied for medewerker", async () => {
    expect(await guardedSend(user(EMP_A), { ...manual, test: true }, world().deps)).toMatchObject({ status: 403 });
  });
  it("test=true denied for service callers", async () => {
    expect(await guardedSend(svc(), { ...reminder, test: true }, world().deps)).toMatchObject({ status: 403, reason: "test_not_allowed_for_service" });
  });
  it("test=true does not bypass STOP", async () => {
    const w = world({ stopped: [`${SA}:${PHONE_A}`] });
    expect(await guardedSend(user(OWNER_A), { to: PHONE_A, message: "t", kind: "manual", test: true }, w.deps)).toMatchObject({ status: 409, reason: "customer_stopped" });
    expect(w.transport).not.toHaveBeenCalled();
  });
  it("test=true does not bypass tenant or consent checks", async () => {
    expect(await guardedSend(user(OWNER_A), { ...manual, test: true, customer_id: CB, to: PHONE_B }, world().deps)).toMatchObject({ status: 403 });
    const w = world({ customers: [cust({ whatsapp_opt_in: null })] });
    expect(await guardedSend(user(OWNER_A), { ...manual, test: true }, w.deps)).toMatchObject({ status: 409, reason: "consent_unknown" });
  });
  it("non-boolean test flag rejected", async () => {
    expect(await guardedSend(user(OWNER_A), { ...manual, test: "true" }, world().deps)).toMatchObject({ status: 400 });
  });
});

describe("8A service callers", () => {
  it("scheduler reminder for own appointment allowed", async () => {
    expect(await guardedSend(svc(), reminder, world().deps)).toMatchObject({ ok: true });
  });
  it("service cannot act without an owned reference", async () => {
    expect(await guardedSend(svc(), { to: PHONE_A, message: "x", kind: "reminder", user_id: SA }, world().deps)).toMatchObject({ status: 403, reason: "service_requires_owned_reference" });
  });
  it("service body user_id must equal the data's tenant", async () => {
    expect(await guardedSend(svc(), { ...reminder, user_id: SB }, world().deps)).toMatchObject({ status: 403, reason: "body_tenant_mismatch" });
  });
  it("mixed-tenant references rejected", async () => {
    expect(await guardedSend(svc(), { ...reminder, appointment_id: APPT_B }, world().deps)).toMatchObject({ status: 403, reason: "reference_tenant_mismatch" });
  });
  it("caller is bound to its message kinds", async () => {
    expect(await guardedSend(svc(), { ...reminder, kind: "campaign" }, world().deps)).toMatchObject({ status: 403, reason: "kind_not_allowed_for_caller" });
  });
});

describe("8A consent and STOP", () => {
  const cases: [Partial<CustomerRow>, string][] = [
    [{ whatsapp_opt_in: null }, "consent_unknown"], [{ whatsapp_opt_in: false }, "customer_opted_out"],
    [{ archived_at: "2026-01-01" }, "customer_communication_blocked"],
    [{ communication_blocked_at: "2026-01-01" }, "customer_communication_blocked"],
    [{ pseudonymized_at: "2026-01-01" }, "customer_communication_blocked"],
  ];
  for (const [over, reason] of cases) {
    it(`blocked: ${reason}`, async () => {
      const w = world({ customers: [cust(over)] });
      expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ status: 409, reason });
      expect(w.transport).not.toHaveBeenCalled();
    });
  }
  it("STOP in salon A blocks A only", async () => {
    const w = world({ stopped: [`${SA}:${PHONE_A}`] });
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ reason: "customer_stopped" });
    expect(await guardedSend(svc(), { to: PHONE_B, message: "x", kind: "reminder", customer_id: CB, appointment_id: APPT_B }, w.deps)).toMatchObject({ ok: true });
  });
  it("marketing (rebook) needs marketing consent", async () => {
    expect(await guardedSend(svc("auto-rebook"), { ...reminder, kind: "rebook" }, world().deps)).toMatchObject({ reason: "marketing_consent_missing" });
    expect(await guardedSend(svc("auto-rebook"), { ...reminder, kind: "rebook" }, world({ customers: [cust({ marketing_opt_in: true })] }).deps)).toMatchObject({ ok: true });
  });
});

describe("8A duplicate prevention", () => {
  it("two concurrent identical requests -> one provider call", async () => {
    const w = world();
    const [a, b] = await Promise.all([guardedSend(svc(), reminder, w.deps), guardedSend(svc(), reminder, w.deps)]);
    expect(w.transport).toHaveBeenCalledTimes(1);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
  });
  it("retry after success -> duplicate, no second send", async () => {
    const w = world();
    await guardedSend(svc(), reminder, w.deps);
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ status: 409, reason: "duplicate" });
    expect(w.transport).toHaveBeenCalledTimes(1);
  });
  it("24h and 2h reminders are separate claims", async () => {
    const w = world();
    await guardedSend(svc(), reminder, w.deps);
    expect(await guardedSend(svc(), { ...reminder, reminder_type: "2h" }, w.deps)).toMatchObject({ ok: true });
  });
  it("error before send (validation) -> no claim, no send", async () => {
    const w = world();
    await guardedSend(svc(), { ...reminder, to: "06-123" }, w.deps);
    expect(w.claims.size).toBe(0);
    expect(w.transport).not.toHaveBeenCalled();
  });
  it("provider accepted but DB finalize fails -> retry is outcome_unknown, not resent", async () => {
    const w = world({ finalizeFails: true });
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ ok: true });
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ status: 409, reason: "outcome_unknown" });
    expect(w.transport).toHaveBeenCalledTimes(1);
  });
  it("transport throws (timeout) -> unknown, retry not resent", async () => {
    const w = world({ transport: async () => { throw new Error("timeout"); } });
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ status: 502, reason: "outcome_unknown" });
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ reason: "outcome_unknown" });
    expect(w.transport).toHaveBeenCalledTimes(1);
  });
  it("provider rejected -> failed, same key not silently resent", async () => {
    const w = world({ transport: async () => ({ accepted: false, code: 63016 }) });
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ status: 502 });
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ reason: "previous_attempt_failed_needs_new_key" });
    expect(w.transport).toHaveBeenCalledTimes(1);
  });
  it("demo tenant: simulated, never calls provider", async () => {
    const w = world({ demo: true });
    expect(await guardedSend(svc(), reminder, w.deps)).toMatchObject({ result: "simulated" });
    expect(w.transport).not.toHaveBeenCalled();
  });
});

describe("8A privacy of log record", () => {
  it("log holds masked phone and message hash, no body or link", async () => {
    const w = world();
    await guardedSend(svc(), { ...reminder, message: "Bevestig: https://x.test/a/tok123", confirmation_link: "https://x.test/a/tok123" }, w.deps);
    const log = JSON.stringify(w.finalize.mock.calls[0][2]);
    expect(log).not.toContain(PHONE_A);
    expect(log).toContain("+31****01");
    expect(log).not.toMatch(/"message"|confirmation_link|booking_token/);
  });
});

describe("8A stays inactive", () => {
  it("no active edge function imports inactive modules", () => {
    const root = "supabase/functions";
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (p.includes("/inactive")) continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && /inactive\//.test(readFileSync(p, "utf8"))) offenders.push(p);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
  it("guard module has no network or env access", () => {
    const src = readFileSync("supabase/functions/_shared/inactive/whatsappSendGuard.ts", "utf8");
    expect(src).not.toMatch(/\bfetch\(|Deno\.env|createClient/);
  });
});
