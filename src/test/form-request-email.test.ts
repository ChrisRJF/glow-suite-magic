import { describe, expect, it } from "vitest";
import { deliverFormRequestEmail, type FormMailDeps } from "../../supabase/functions/_shared/inactive/formRequestEmail";

// Fictitious tenants and customers only.
const T = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";
const TOK = "a".repeat(64);

function setup(over: Partial<FormMailDeps> = {}) {
  const sent: any[] = []; const logs: any[] = [];
  const deps: FormMailDeps = {
    readStopSwitch: async () => ({ sending_enabled: true }),
    allowedRecipients: new Set(["test@fictief.nl"]),
    allowedTenants: new Set([T]),
    loadRequest: async (t, id) => (t === T && id === R ? { id: R, user_id: T, customer_id: "c1", status: "sent", expires_at: "2999-01-01T00:00:00Z", is_demo: true } : null),
    loadCustomer: async (t, id) => (t === T && id === "c1" ? { id: "c1", name: "Fien Fictief", email: "test@fictief.nl", archived_at: null, pseudonymized_at: null, communication_blocked_at: null } : null),
    loadSalon: async () => ({ salon_name: "Studio Test", public_slug: "studiotest" }),
    rotateToken: async () => "b".repeat(64),
    sendEmail: async (m) => { sent.push(m); return { ok: true, id: "p1" }; },
    log: async (r) => { logs.push(r); },
    ...over,
  };
  return { deps, sent, logs };
}

describe("intake e-mail (inactive)", () => {
  it("sends only the link, never answers or token in logs", async () => {
    const { deps, sent, logs } = setup();
    const r = await deliverFormRequestEmail(deps, { tenantId: T, requestId: R, formTitle: "Intake", token: TOK });
    expect(r).toEqual({ ok: true, sent: true });
    expect(sent[0].text).toContain(`/formulier/${TOK}`);
    expect(sent[0].idempotencyKey).toBe(`form_request:${R}:initial`);
    expect(JSON.stringify(logs)).not.toContain(TOK);
  });
  it("fails closed when stop switch is off or unreadable", async () => {
    for (const read of [async () => ({ sending_enabled: false }), async () => { throw new Error("x"); }]) {
      const { deps, sent } = setup({ readStopSwitch: read as any });
      expect(await deliverFormRequestEmail(deps, { tenantId: T, requestId: R, formTitle: "I", token: TOK })).toEqual({ ok: false, reason: "email_stopped" });
      expect(sent).toHaveLength(0);
    }
  });
  it("refuses another tenant's request", async () => {
    const { deps, sent } = setup({ allowedTenants: new Set([T, OTHER]) });
    expect((await deliverFormRequestEmail(deps, { tenantId: OTHER, requestId: R, formTitle: "I", token: TOK })).ok).toBe(false);
    expect(sent).toHaveLength(0);
  });
  it("refuses recipients outside the server allow-list and blocked customers", async () => {
    const a = setup({ allowedRecipients: new Set() });
    expect(await deliverFormRequestEmail(a.deps, { tenantId: T, requestId: R, formTitle: "I", token: TOK })).toEqual({ ok: false, reason: "recipient_not_allowed" });
    const b = setup({ loadCustomer: async () => ({ id: "c1", name: "X", email: "test@fictief.nl", archived_at: null, pseudonymized_at: null, communication_blocked_at: "2026-01-01" }) });
    expect(await deliverFormRequestEmail(b.deps, { tenantId: T, requestId: R, formTitle: "I", token: TOK })).toEqual({ ok: false, reason: "customer_communication_blocked" });
  });
  it("resend rotates token, ignores supplied token and uses a resend idempotency key", async () => {
    const { deps, sent } = setup();
    await deliverFormRequestEmail(deps, { tenantId: T, requestId: R, formTitle: "I", token: TOK, resend: true, attempt: 1 });
    expect(sent[0].text).toContain("b".repeat(64));
    expect(sent[0].text).not.toContain(TOK);
    expect(sent[0].idempotencyKey).toBe(`form_request:${R}:resend-1`);
  });
  it("refuses closed or expired requests and reports provider errors as unclear", async () => {
    const a = setup({ loadRequest: async () => ({ id: R, user_id: T, customer_id: "c1", status: "completed", expires_at: "2999-01-01T00:00:00Z", is_demo: true }) });
    expect(await deliverFormRequestEmail(a.deps, { tenantId: T, requestId: R, formTitle: "I", token: TOK })).toEqual({ ok: false, reason: "request_not_open" });
    const b = setup({ sendEmail: async () => { throw new Error("timeout"); } });
    expect(await deliverFormRequestEmail(b.deps, { tenantId: T, requestId: R, formTitle: "I", token: TOK })).toEqual({ ok: false, reason: "provider_unclear" });
  });
});
