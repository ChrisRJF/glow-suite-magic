import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { authorizeWhatsAppSend } from "../../supabase/functions/_shared/inactive/whatsappSendAuth";
import { evaluateWhatsAppConsent, isStopKeyword } from "../../supabase/functions/_shared/inactive/whatsappConsent";
import { handleGatewayEvent, signV1, flagEnabled, type ReceiverStore } from "../../supabase/functions/_shared/inactive/gatewayReceiver";

const T1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const base = { bodyUserId: T1, bodyTest: false, roleInTenant: null, customerInTenant: null } as const;

describe("whatsapp-send authorization", () => {
  it("anonymous is rejected", () => {
    expect(authorizeWhatsAppSend({ ...base, identity: { kind: "anonymous" } })).toMatchObject({ allow: false, status: 401 });
  });
  it("forged user_id (non-member) is 403", () => {
    expect(authorizeWhatsAppSend({ ...base, identity: { kind: "user", userId: U2 } })).toMatchObject({ allow: false, status: 403 });
  });
  it("test=true does not bypass membership", () => {
    expect(authorizeWhatsAppSend({ ...base, bodyTest: true, identity: { kind: "user", userId: U2 } })).toMatchObject({ allow: false, status: 403 });
  });
  it("test=true requires owner/admin", () => {
    expect(authorizeWhatsAppSend({ ...base, bodyTest: true, roleInTenant: "medewerker", identity: { kind: "user", userId: U2 } })).toMatchObject({ allow: false, status: 403 });
    expect(authorizeWhatsAppSend({ ...base, bodyTest: true, roleInTenant: "eigenaar", identity: { kind: "user", userId: T1 } })).toMatchObject({ allow: true, test: true });
  });
  it("cross-tenant customer is 403 even for service", () => {
    expect(authorizeWhatsAppSend({ ...base, customerInTenant: false, identity: { kind: "service" } })).toMatchObject({ allow: false, status: 403 });
  });
  it("service caller (scheduler) allowed, never with test", () => {
    expect(authorizeWhatsAppSend({ ...base, identity: { kind: "service" } })).toMatchObject({ allow: true, via: "service", test: false });
    expect(authorizeWhatsAppSend({ ...base, bodyTest: true, identity: { kind: "service" } })).toMatchObject({ allow: false, status: 403 });
  });
  it("malformed user_id is 400", () => {
    expect(authorizeWhatsAppSend({ ...base, bodyUserId: "x", identity: { kind: "service" } })).toMatchObject({ allow: false, status: 400 });
  });
});

describe("whatsapp consent fails closed", () => {
  const c = { phone: "+31600000000" };
  it("opt-in absent (null) is not consent", () => {
    expect(evaluateWhatsAppConsent({ purpose: "transactional", customer: { ...c, whatsapp_opt_in: null }, stoppedInTenant: false }).allowed).toBe(false);
  });
  it("opt-in false is blocked", () => {
    expect(evaluateWhatsAppConsent({ purpose: "transactional", customer: { ...c, whatsapp_opt_in: false }, stoppedInTenant: false }).allowed).toBe(false);
  });
  it("STOP wins over opt-in true", () => {
    expect(evaluateWhatsAppConsent({ purpose: "transactional", customer: { ...c, whatsapp_opt_in: true }, stoppedInTenant: true })).toEqual({ allowed: false, reason: "customer_stopped" });
  });
  it("communication_blocked wins", () => {
    expect(evaluateWhatsAppConsent({ purpose: "transactional", customer: { ...c, whatsapp_opt_in: true, communication_blocked_at: "2026-01-01" }, stoppedInTenant: false }).allowed).toBe(false);
  });
  it("explicit true allowed", () => {
    expect(evaluateWhatsAppConsent({ purpose: "transactional", customer: { ...c, whatsapp_opt_in: true }, stoppedInTenant: false }).allowed).toBe(true);
  });
  it("STOP keywords", () => {
    expect(isStopKeyword(" STOP ")).toBe(true);
    expect(isStopKeyword("stop met die herinneringen")).toBe(false);
  });
});

describe("gateway receiver (inactive)", () => {
  const secret = "test-secret-not-real";
  const now = 1_791_575_000;
  const cfg = { enabled: true, secret, environment: "test" };
  const body = (o: Record<string, unknown>) => JSON.stringify({ event_id: "e1", environment: "test", gateway_tenant_ref: "ref1", type: "stop", phone: "+31600000000", ...o });
  const mkStore = (over: Partial<ReceiverStore> = {}) => {
    const seen = new Set<string>();
    return {
      resolveTenant: vi.fn(async (r: string) => (r === "ref1" ? T1 : null)),
      applyOnce: vi.fn(async (_t: string, id: string) => (seen.has(id) ? "duplicate" : (seen.add(id), "applied")) as any),
      ...over,
    } as ReceiverStore;
  };
  const send = async (store: ReceiverStore, raw: string, c = cfg, ts = String(now), sig?: string) =>
    handleGatewayEvent(c, store, { timestamp: ts, signature: sig ?? (await signV1(secret, ts, raw)) }, raw, now);

  it("flag unset/false means disabled, store untouched", async () => {
    expect(flagEnabled(undefined)).toBe(false);
    const s = mkStore();
    expect((await send(s, body({}), { ...cfg, enabled: false })).status).toBe(404);
    expect(s.applyOnce).not.toHaveBeenCalled();
  });
  it("missing secret denied", async () => {
    expect((await send(mkStore(), body({}), { ...cfg, secret: undefined })).status).toBe(503);
  });
  it("bad signature and stale timestamp rejected", async () => {
    expect((await send(mkStore(), body({}), cfg, String(now), "v1=00")).status).toBe(401);
    const old = String(now - 1000);
    expect((await send(mkStore(), body({}), cfg, old)).status).toBe(401);
  });
  it("unknown/disabled tenant 403", async () => {
    expect((await send(mkStore(), body({ gateway_tenant_ref: "other" }))).status).toBe(403);
  });
  it("wrong environment 403", async () => {
    expect((await send(mkStore(), body({ environment: "production" }))).status).toBe(403);
  });
  it("replay of same event_id is idempotent", async () => {
    const s = mkStore();
    expect((await send(s, body({}))).body).toMatchObject({ duplicate: false });
    expect((await send(s, body({}))).body).toMatchObject({ duplicate: true });
  });
  it("failed store returns 500 so gateway retries", async () => {
    const s = mkStore({ applyOnce: vi.fn(async () => { throw new Error("db"); }) });
    expect((await send(s, body({}))).status).toBe(500);
  });
  it("free text never becomes a booking/payment", async () => {
    const s = mkStore();
    await send(s, body({ type: "message", text: "boek mij morgen 10:00" }));
    expect((s.applyOnce as any).mock.calls[0][2]).toEqual({ kind: "ignored", reason: "unsupported_type" });
  });
});

describe("inactive modules are not wired into deployed functions", () => {
  it("no entrypoint imports _shared/inactive", () => {
    const root = "supabase/functions";
    for (const d of readdirSync(root)) {
      if (d.startsWith("_") || !statSync(join(root, d)).isDirectory()) continue;
      const f = join(root, d, "index.ts");
      try { expect(readFileSync(f, "utf8")).not.toMatch(/_shared\/inactive/); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
    }
    for (const f of readdirSync(join(root, "_shared"))) {
      if (f.endsWith(".ts")) expect(readFileSync(join(root, "_shared", f), "utf8")).not.toMatch(/inactive\//);
    }
  });
  it("whatsapp-inbound stays 410", () => {
    expect(readFileSync("supabase/functions/whatsapp-inbound/index.ts", "utf8")).toMatch(/status: 410/);
  });
});
