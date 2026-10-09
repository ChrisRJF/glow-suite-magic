import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { authorizeWhatsAppSend } from "../../supabase/functions/_shared/inactive/whatsappSendAuth";
import { evaluateWhatsAppConsent, isStopKeyword } from "../../supabase/functions/_shared/inactive/whatsappConsent";
import {
  handleGatewayCommand, signV1, sha256Hex, flagEnabled, COMMAND_PATH,
  type ReceiverStore, type ProcessOutcome, type TenantLink, type ActionType,
} from "../../supabase/functions/_shared/inactive/gatewayReceiver";

const T1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const base = { bodyUserId: T1, bodyTest: false, roleInTenant: null, customerInTenant: null } as const;

describe("send authorization (tenant check)", () => {
  it("anonymous 401", () => {
    expect(authorizeWhatsAppSend({ ...base, identity: { kind: "anonymous" } })).toMatchObject({ allow: false, status: 401 });
  });
  it("forged user_id (non-member) 403", () => {
    expect(authorizeWhatsAppSend({ ...base, identity: { kind: "user", userId: U2 } })).toMatchObject({ allow: false, status: 403 });
  });
  it("test=true does not bypass membership", () => {
    expect(authorizeWhatsAppSend({ ...base, bodyTest: true, identity: { kind: "user", userId: U2 } })).toMatchObject({ allow: false, status: 403 });
  });
  it("test=true only for owner/admin", () => {
    expect(authorizeWhatsAppSend({ ...base, bodyTest: true, roleInTenant: "receptie", identity: { kind: "user", userId: U2 } })).toMatchObject({ allow: false, status: 403 });
    expect(authorizeWhatsAppSend({ ...base, bodyTest: true, roleInTenant: "eigenaar", identity: { kind: "user", userId: T1 } })).toMatchObject({ allow: true, test: true });
  });
  it("cross-tenant customer 403, also for service", () => {
    expect(authorizeWhatsAppSend({ ...base, customerInTenant: false, identity: { kind: "service" } })).toMatchObject({ allow: false, status: 403 });
  });
  it("service caller allowed, never with test", () => {
    expect(authorizeWhatsAppSend({ ...base, identity: { kind: "service" } })).toMatchObject({ allow: true, via: "service" });
    expect(authorizeWhatsAppSend({ ...base, bodyTest: true, identity: { kind: "service" } })).toMatchObject({ allow: false, status: 403 });
  });
  it("malformed user_id 400", () => {
    expect(authorizeWhatsAppSend({ ...base, bodyUserId: "x", identity: { kind: "service" } })).toMatchObject({ allow: false, status: 400 });
  });
});

describe("consent (explicit, fail closed)", () => {
  const c = { user_id: T1, phone: "+31600000000" };
  const ev = (cust: any, extra: any = {}) =>
    evaluateWhatsAppConsent({ purpose: "transactional", tenantId: T1, customer: cust, stoppedInTenant: false, ...extra });
  it("opt-in null is not consent", () => expect(ev({ ...c, whatsapp_opt_in: null }).allowed).toBe(false));
  it("opt-in false blocked", () => expect(ev({ ...c, whatsapp_opt_in: false }).allowed).toBe(false));
  it("STOP wins over opt-in true", () => expect(ev({ ...c, whatsapp_opt_in: true }, { stoppedInTenant: true })).toEqual({ allowed: false, reason: "customer_stopped" }));
  it("communication_blocked wins", () => expect(ev({ ...c, whatsapp_opt_in: true, communication_blocked_at: "2026-01-01" }).allowed).toBe(false));
  it("customer of other tenant blocked", () => expect(ev({ ...c, user_id: U2, whatsapp_opt_in: true })).toEqual({ allowed: false, reason: "customer_not_in_tenant" }));
  it("unknown owner blocked", () => expect(ev({ ...c, user_id: null, whatsapp_opt_in: true }).allowed).toBe(false));
  it("marketing needs separate consent", () => {
    expect(ev({ ...c, whatsapp_opt_in: true }, { purpose: "marketing" }).allowed).toBe(false);
    expect(ev({ ...c, whatsapp_opt_in: true, marketing_consent: true }, { purpose: "marketing" }).allowed).toBe(true);
  });
  it("explicit true allowed for transactional", () => expect(ev({ ...c, whatsapp_opt_in: true }).allowed).toBe(true));
  it("STOP keywords exact only", () => {
    expect(isStopKeyword(" STOP ")).toBe(true);
    expect(isStopKeyword("stop met die herinneringen")).toBe(false);
  });
});

// ---------- Gateway receiver (contract v1) ----------
const KEY_NEW = "k2", KEY_OLD = "k1";
const SECRET_NEW = "fictief-nieuw-geheim-0123456789abcdef0123";
const SECRET_OLD = "fictief-oud-geheim-0123456789abcdef012345";
const NOW = 1_791_575_000;
const cfg = { enabled: true, keys: { [KEY_NEW]: SECRET_NEW, [KEY_OLD]: SECRET_OLD }, contactRefVersions: ["v1"] };
const IK = "a".repeat(64);
const ALL: ActionType[] = ["opt_out_signal", "inbound_message_record", "delivery_status_record", "confirmation_token_received"];

const cmd = (o: Record<string, unknown> = {}) => ({
  contract_version: 1, idempotency_key: IK, tenant_id: "tenant_test", action_type: "opt_out_signal",
  provider_event_id: "msg:wamid.TEST", occurred_at: "2026-10-09T20:00:00Z",
  data: { channel: "whatsapp", contact_ref: "c1.v1." + "d".repeat(64) }, ...o,
});

/** Simulated store mirroring the proposed SQL function semantics. */
function memStore(links: Record<string, TenantLink> = { tenant_test: { salonId: T1, enabled: true, allowedActionTypes: ALL } }) {
  const receipts = new Map<string, { hash: string; code: number }>();
  const optOuts = new Set<string>();
  const effects: unknown[] = [];
  const store: ReceiverStore = {
    resolveTenant: vi.fn(async (t: string) => links[t] ?? null),
    processOnce: vi.fn(async (salonId, rc, effect): Promise<ProcessOutcome> => {
      const ex = receipts.get(rc.idempotencyKey);
      if (ex) return ex.hash === rc.requestHash ? { result: "duplicate", storedCode: ex.code, storedBody: {} } : { result: "conflict" };
      let out: ProcessOutcome = { result: "applied" };
      if (effect.kind === "opt_out") {
        const k = `${salonId}:${effect.contactRef}`;
        if (optOuts.has(k)) out = { result: "accepted_noop" }; else optOuts.add(k);
      }
      effects.push(effect);
      receipts.set(rc.idempotencyKey, { hash: rc.requestHash, code: out.result === "applied" ? 200 : 202 });
      return out;
    }),
  };
  return { store, effects, optOuts };
}

async function req(body: unknown, o: { keyId?: string; secret?: string; ts?: number; nonce?: string; sig?: string; method?: string; path?: string; raw?: string } = {}) {
  const raw = o.raw ?? JSON.stringify(body);
  const keyId = o.keyId ?? KEY_NEW, ts = String(o.ts ?? NOW), method = o.method ?? "POST", path = o.path ?? COMMAND_PATH;
  const sig = o.sig ?? (await signV1(keyId, o.secret ?? (keyId === KEY_OLD ? SECRET_OLD : SECRET_NEW), ts, method, path, raw));
  const nonce = o.nonce ?? (body as any)?.idempotency_key;
  return { method, path, rawBody: raw, headers: { "x-gs-key-id": keyId, "x-gs-timestamp": ts, "x-gs-nonce": nonce, "x-gs-signature": sig } };
}

describe("receiver: flag and configuration", () => {
  it("flag unset/anything but 'true' is off", () => {
    expect(flagEnabled(undefined)).toBe(false);
    expect(flagEnabled("1")).toBe(false);
  });
  it("disabled flag 503, store never touched", async () => {
    const m = memStore();
    expect((await handleGatewayCommand({ ...cfg, enabled: false }, m.store, await req(cmd()), NOW)).status).toBe(503);
    expect(m.store.resolveTenant).not.toHaveBeenCalled();
  });
  it("missing keys deny all", async () => {
    expect((await handleGatewayCommand({ enabled: true, keys: {}, contactRefVersions: ["v1"] }, memStore().store, await req(cmd()), NOW)).body.code).toBe("bad_signature");
  });
  it("wrong method/path 404", async () => {
    expect((await handleGatewayCommand(cfg, memStore().store, await req(cmd(), { method: "GET" }), NOW)).status).toBe(404);
    expect((await handleGatewayCommand(cfg, memStore().store, await req(cmd(), { path: "/other" }), NOW)).status).toBe(404);
  });
});

describe("receiver: signature, rotation, timestamp, body", () => {
  it("current key accepted", async () => {
    expect((await handleGatewayCommand(cfg, memStore().store, await req(cmd()), NOW)).body.code).toBe("applied");
  });
  it("previous key accepted during grace", async () => {
    expect((await handleGatewayCommand(cfg, memStore().store, await req(cmd(), { keyId: KEY_OLD }), NOW)).body.code).toBe("applied");
  });
  it("removed key rejected", async () => {
    const c2 = { enabled: true, keys: { [KEY_NEW]: SECRET_NEW }, contactRefVersions: ["v1"] };
    expect((await handleGatewayCommand(c2, memStore().store, await req(cmd(), { keyId: KEY_OLD }), NOW)).status).toBe(401);
  });
  it("key id swapped into other key's signature rejected", async () => {
    const r = await req(cmd(), { keyId: KEY_NEW, secret: SECRET_OLD });
    expect((await handleGatewayCommand(cfg, memStore().store, r, NOW)).body.code).toBe("bad_signature");
  });
  it("stale or future timestamp rejected", async () => {
    expect((await handleGatewayCommand(cfg, memStore().store, await req(cmd(), { ts: NOW - 301 }), NOW)).body.code).toBe("stale_timestamp");
    expect((await handleGatewayCommand(cfg, memStore().store, await req(cmd(), { ts: NOW + 301 }), NOW)).body.code).toBe("stale_timestamp");
  });
  it("body tampered after signing rejected", async () => {
    const r = await req(cmd());
    r.rawBody = JSON.stringify(cmd({ tenant_id: "tenant_other" }));
    expect((await handleGatewayCommand(cfg, memStore().store, r, NOW)).body.code).toBe("bad_signature");
  });
  it("path signed differently rejected", async () => {
    const r = await req(cmd(), { path: "/x" }); r.path = COMMAND_PATH;
    expect((await handleGatewayCommand(cfg, memStore().store, r, NOW)).body.code).toBe("bad_signature");
  });
  it("nonce must equal idempotency_key", async () => {
    expect((await handleGatewayCommand(cfg, memStore().store, await req(cmd(), { nonce: "b".repeat(64) }), NOW)).status).toBe(401);
  });
  it("body > 64 KB rejected", async () => {
    const raw = JSON.stringify(cmd({ provider_event_id: "x".repeat(70_000) }));
    expect((await handleGatewayCommand(cfg, memStore().store, await req(null, { raw, nonce: IK }), NOW)).status).toBe(400);
  });
});

describe("receiver: strict schema and privacy", () => {
  const bad = async (o: Record<string, unknown>) =>
    (await handleGatewayCommand(cfg, memStore().store, await req(cmd(o)), NOW)).body.code;
  it("wrong contract_version", async () => expect(await bad({ contract_version: 2 })).toBe("invalid_command"));
  it("unknown top-level field", async () => expect(await bad({ text: "hoi" })).toBe("invalid_command"));
  it("bad idempotency_key", async () => expect(await bad({ idempotency_key: "short", })).toBe("invalid_command"));
  it("unknown action_type", async () => expect(await bad({ action_type: "create_appointment" })).toBe("invalid_command"));
  it("bad occurred_at", async () => expect(await bad({ occurred_at: "gisteren" })).toBe("invalid_command"));
  it("STOP with raw phone number as contact_ref rejected", async () =>
    expect(await bad({ data: { channel: "whatsapp", contact_ref: "31600000000" } })).toBe("invalid_command"));
  it("STOP with extra fields (e.g. text) rejected", async () =>
    expect(await bad({ data: { channel: "whatsapp", contact_ref: "c1.v1." + "d".repeat(64), text: "STOP" } })).toBe("invalid_command"));
  it("inbound record carrying a body rejected (metadata only)", async () =>
    expect(await bad({ action_type: "inbound_message_record", data: { body: "boek mij morgen 10:00" } })).toBe("invalid_command"));
  it("status event with unknown status rejected", async () =>
    expect(await bad({ action_type: "delivery_status_record", data: { outbound_ref: "out_ref_0123456789ab", status: "paid" } })).toBe("invalid_command"));
  it("status event with extra fields rejected", async () =>
    expect(await bad({ action_type: "delivery_status_record", data: { outbound_ref: "out_ref_0123456789ab", status: "read", phone: "+31600000000" } })).toBe("invalid_command"));
  it("confirmation needs opaque token + attend/cancel, no free text", async () => {
    expect(await bad({ action_type: "confirmation_token_received", data: { token: "Ik kom", choice: "attend" } })).toBe("invalid_command");
    expect(await bad({ action_type: "confirmation_token_received", data: { token: "tok_abcdef0123456789", choice: "ja" } })).toBe("invalid_command");
  });
  it("no effect ever creates appointment/payment", async () => {
    const m = memStore();
    await handleGatewayCommand(cfg, m.store, await req(cmd({ action_type: "inbound_message_record", data: {} })), NOW);
    expect(m.effects).toEqual([{ kind: "inbound_record", providerEventId: "msg:wamid.TEST", occurredAt: "2026-10-09T20:00:00Z" }]);
  });
});

describe("receiver: tenant allow-list", () => {
  it("unknown tenant 403", async () => {
    expect((await handleGatewayCommand(cfg, memStore().store, await req(cmd({ tenant_id: "nobody" })), NOW)).body.code).toBe("tenant_not_authorized");
  });
  it("disabled link 403", async () => {
    const m = memStore({ tenant_test: { salonId: T1, enabled: false, allowedActionTypes: ALL } });
    expect((await handleGatewayCommand(cfg, m.store, await req(cmd()), NOW)).status).toBe(403);
    expect(m.store.processOnce).not.toHaveBeenCalled();
  });
  it("action not allowed for tenant 403", async () => {
    const m = memStore({ tenant_test: { salonId: T1, enabled: true, allowedActionTypes: ["delivery_status_record"] } });
    expect((await handleGatewayCommand(cfg, m.store, await req(cmd()), NOW)).status).toBe(403);
  });
  it("GlowSuite resolves salon id itself (scoped write)", async () => {
    const m = memStore();
    await handleGatewayCommand(cfg, m.store, await req(cmd()), NOW);
    expect((m.store.processOnce as any).mock.calls[0][0]).toBe(T1);
  });
});

describe("receiver: atomic idempotency", () => {
  it("identical replay = one effect, 200 duplicate", async () => {
    const m = memStore();
    const r = await req(cmd());
    expect((await handleGatewayCommand(cfg, m.store, r, NOW)).body.code).toBe("applied");
    const again = await handleGatewayCommand(cfg, m.store, await req(cmd(), { ts: NOW + 10 }), NOW + 10);
    expect(again).toMatchObject({ status: 200, body: { code: "duplicate" } });
    expect(m.effects).toHaveLength(1);
  });
  it("same key, different content = 409 conflict, no effect", async () => {
    const m = memStore();
    await handleGatewayCommand(cfg, m.store, await req(cmd()), NOW);
    const other = cmd({ data: { channel: "whatsapp", contact_ref: "c1.v1." + "e".repeat(64) } });
    expect((await handleGatewayCommand(cfg, m.store, await req(other), NOW)).status).toBe(409);
    expect(m.effects).toHaveLength(1);
  });
  it("new key for already opted-out contact = 202 accepted_noop", async () => {
    const m = memStore();
    await handleGatewayCommand(cfg, m.store, await req(cmd()), NOW);
    const r2 = await handleGatewayCommand(cfg, m.store, await req(cmd({ idempotency_key: "c".repeat(64) })), NOW);
    expect(r2).toMatchObject({ status: 202, body: { code: "accepted_noop" } });
  });
  it("request hash is sha256 of exact body", async () => {
    const m = memStore(); const r = await req(cmd());
    await handleGatewayCommand(cfg, m.store, r, NOW);
    expect((m.store.processOnce as any).mock.calls[0][1].requestHash).toBe(await sha256Hex(r.rawBody));
  });
  it("store failure = 503 transient, nothing claimed", async () => {
    const m = memStore();
    (m.store.processOnce as any).mockRejectedValueOnce(new Error("db down"));
    expect((await handleGatewayCommand(cfg, m.store, await req(cmd()), NOW)).status).toBe(503);
    expect((await handleGatewayCommand(cfg, m.store, await req(cmd()), NOW)).body.code).toBe("applied");
  });
});

describe("proposed SQL stays a proposal", () => {
  const sql = readFileSync("docs/proposed-migrations/2026-10-09_whatsapp_gateway_receiver.sql", "utf8");
  it("has contract tables and atomic function", () => {
    expect(sql).toMatch(/gateway_command_receipts/);
    expect(sql).toMatch(/gateway_tenant_links/);
    expect(sql).toMatch(/on conflict \(idempotency_key\) do nothing/);
    expect(sql).toMatch(/'conflict','code',409/);
  });
  it("is not in supabase/migrations", () => {
    for (const f of readdirSync("supabase/migrations")) {
      expect(readFileSync(join("supabase/migrations", f), "utf8")).not.toMatch(/gateway_command_receipts/);
    }
  });
});

describe("inactive modules not wired into deployed code", () => {
  it("no entrypoint or shared module imports _shared/inactive", () => {
    const root = "supabase/functions";
    for (const d of readdirSync(root)) {
      if (d.startsWith("_") || !statSync(join(root, d)).isDirectory()) continue;
      try { expect(readFileSync(join(root, d, "index.ts"), "utf8")).not.toMatch(/inactive\//); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
    }
    for (const f of readdirSync(join(root, "_shared"))) {
      if (f.endsWith(".ts")) expect(readFileSync(join(root, "_shared", f), "utf8")).not.toMatch(/inactive\//);
    }
  });
  it("whatsapp-inbound stays 410", () => {
    expect(readFileSync("supabase/functions/whatsapp-inbound/index.ts", "utf8")).toMatch(/status: 410/);
  });
});
