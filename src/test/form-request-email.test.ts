import { describe, expect, it } from "vitest";
import { deliverFormRequestEmail, emailScopeAllowed, FORM_EMAIL_TENANTS, type FormMailDeps } from "../../supabase/functions/_shared/formRequestEmail";

// Fictitious tenants and customers only.
const NOVA = "5dbfcbd4-48ff-4010-a1cc-07ed737880ce";
const BEAUTYCARE = "1c6c885e-c944-4717-b2ef-9cfdb9fa15ae";
const R = "33333333-3333-4333-8333-333333333333";
const TOK = "a".repeat(64);
const NEW = "b".repeat(64);

function setup(over: Partial<FormMailDeps> = {}) {
  const sent: any[] = []; const logs: any[] = []; const commits: string[] = [];
  const deps: FormMailDeps = {
    readStopSwitch: async () => ({ sending_enabled: true }),
    allowedRecipients: new Set(["test@fictief.nl"]),
    allowedTenants: FORM_EMAIL_TENANTS,
    loadRequest: async (t, id) => (t === NOVA && id === R ? { id: R, user_id: NOVA, customer_id: "c1", status: "sent", expires_at: "2999-01-01T00:00:00Z" } : null),
    loadCustomer: async (t, id) => (t === NOVA && id === "c1" ? { id: "c1", name: "Fien Fictief", email: "Test@Fictief.nl", archived_at: null, pseudonymized_at: null, communication_blocked_at: null } : null),
    loadSalon: async () => ({ salon_name: "Studio Test", public_slug: "studiotest" }),
    newToken: async () => ({ token: NEW, hash: "h-new" }),
    commitToken: async (_t, _id, h) => { commits.push(h); return true; },
    alreadySent: async (_t, key) => logs.some((l) => l.status === "sent" && l.idempotency_key === key),
    sendEmail: async (m) => { sent.push(m); return { ok: true, id: "p1" }; },
    log: async (r) => { logs.push(r); },
    ...over,
  };
  return { deps, sent, logs, commits };
}
const run = (d: FormMailDeps, extra: Record<string, unknown> = {}) => deliverFormRequestEmail(d, { tenantId: NOVA, requestId: R, formTitle: "Intake", token: TOK, ...extra });

describe("intake e-mail", () => {
  it("scope: Studio Nova test-only, Beautycare own customers, unknown recipients denied", () => {
    const rec = new Set(["test@fictief.nl"]);
    expect(emailScopeAllowed(NOVA, "test@fictief.nl", FORM_EMAIL_TENANTS, rec)).toBe(true);
    expect(emailScopeAllowed(BEAUTYCARE, "test@fictief.nl", FORM_EMAIL_TENANTS, rec)).toBe(true);
    expect(emailScopeAllowed(NOVA, "echt@klant.nl", FORM_EMAIL_TENANTS, rec)).toBe(false);
    expect(emailScopeAllowed(NOVA, "test@fictief.nl", FORM_EMAIL_TENANTS, new Set())).toBe(false);
  });
  it("sends only the existing link; token never in logs; repeat is a duplicate", async () => {
    const { deps, sent, logs } = setup();
    expect(await run(deps)).toEqual({ ok: true, sent: true });
    expect(sent[0].text).toContain(`/formulier/${TOK}`);
    expect(sent[0].idempotencyKey).toBe(`form_request:${R}:initial`);
    expect(JSON.stringify(logs)).not.toContain(TOK);
    expect(await run(deps)).toEqual({ ok: true, sent: false, duplicate: true });
    expect(sent).toHaveLength(1);
  });
  it("fails closed when stop switch is off or unreadable", async () => {
    for (const read of [async () => ({ sending_enabled: false }), async () => { throw new Error("x"); }]) {
      const { deps, sent } = setup({ readStopSwitch: read as any });
      expect(await run(deps)).toEqual({ ok: false, reason: "email_stopped" });
      expect(sent).toHaveLength(0);
    }
  });
  it("Beautycare cannot mail a request belonging to another salon", async () => {
    const { deps, sent } = setup();
    expect(await deliverFormRequestEmail(deps, { tenantId: BEAUTYCARE, requestId: R, formTitle: "I", token: TOK })).toEqual({ ok: false, reason: "request_not_found" });
    expect(sent).toHaveLength(0);
  });
  it("refuses blocked customers and closed requests", async () => {
    const b = setup({ loadCustomer: async () => ({ id: "c1", name: "X", email: "test@fictief.nl", archived_at: null, pseudonymized_at: null, communication_blocked_at: "2026-01-01" }) });
    expect(await run(b.deps)).toEqual({ ok: false, reason: "customer_communication_blocked" });
    const a = setup({ loadRequest: async () => ({ id: R, user_id: NOVA, customer_id: "c1", status: "completed", expires_at: "2999-01-01T00:00:00Z" }) });
    expect(await run(a.deps)).toEqual({ ok: false, reason: "request_not_open" });
  });
  it("resend rotates the token only after the provider accepted", async () => {
    const { deps, sent, commits } = setup();
    expect(await run(deps, { resendKey: "k-00000001" })).toEqual({ ok: true, sent: true });
    expect(sent[0].text).toContain(NEW);
    expect(sent[0].idempotencyKey).toBe(`form_request:${R}:resend:k-00000001`);
    expect(commits).toEqual(["h-new"]);
  });
  it("provider failure or unclear outcome keeps the old link (no rotation)", async () => {
    const f = setup({ sendEmail: async () => ({ ok: false }) });
    expect(await run(f.deps, { resendKey: "k-00000002" })).toEqual({ ok: false, reason: "provider_failed" });
    expect(f.commits).toHaveLength(0);
    const u = setup({ sendEmail: async () => { throw new Error("timeout"); } });
    expect(await run(u.deps, { resendKey: "k-00000003" })).toEqual({ ok: false, reason: "provider_unclear" });
    expect(u.commits).toHaveLength(0);
  });
  it("unreadable idempotency log blocks sending", async () => {
    const { deps, sent } = setup({ alreadySent: async () => { throw new Error("db"); } });
    expect(await run(deps)).toEqual({ ok: false, reason: "idempotency_unreadable" });
    expect(sent).toHaveLength(0);
  });
});

import { emailScopeAllowed as _scope, FORM_EMAIL_TENANTS as _T } from "../../supabase/functions/_shared/formRequestEmail";
describe("Beautycare intake email scope", () => {
  const BC = "1c6c885e-c944-4717-b2ef-9cfdb9fa15ae";
  const test = new Set(["chrisrjfrancois@hotmail.com"]);
  it("Beautycare may mail its own customer address", () => expect(_scope(BC, "klant@example.nl", _T, test)).toBe(true));
  it("Studio Nova stays limited to the test address", () => {
    expect(_scope("5dbfcbd4-48ff-4010-a1cc-07ed737880ce", "klant@example.nl", _T, test)).toBe(false);
    expect(_scope("5dbfcbd4-48ff-4010-a1cc-07ed737880ce", "chrisrjfrancois@hotmail.com", _T, test)).toBe(true);
  });
  it("other salons stay denied", () => expect(_scope("cbd7d158-0133-4f2f-a504-4b82f73f2e20", "chrisrjfrancois@hotmail.com", _T, test)).toBe(false));
  it("invalid address denied", () => expect(_scope(BC, "geen-adres", _T, test)).toBe(false));
});
