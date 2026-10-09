// Round 3: STOP contact refs, delivery status, transactional receiver.
// ALL tests use fictitious data and IN-MEMORY simulated storage. None of these
// are database integration tests.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  computeContactRef, normalizeE164, parseContactRef, checkStopBeforeSend, decodeBase64Strict,
} from "../../supabase/functions/_shared/inactive/contactRef";
import { nextDeliveryState, type DeliveryState, type DeliveryStatus } from "../../supabase/functions/_shared/inactive/deliveryStatus";
import {
  handleGatewayCommand, signV1, COMMAND_PATH,
  type ReceiverStore, type ProcessOutcome, type TenantLink, type ActionType, type Effect, type ReceiptKey,
} from "../../supabase/functions/_shared/inactive/gatewayReceiver";
import { evaluateWhatsAppConsent } from "../../supabase/functions/_shared/inactive/whatsappConsent";

// Round 6: master keys are raw bytes decoded from Base64 (fictitious test keys).
const MASTER_V1 = decodeBase64Strict("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")!;
const MASTER_V2 = decodeBase64Strict("ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=")!;
const SALON_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALON_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PHONE = "+31612345678"; // fictitious

// ---------------- simulated transactional store ----------------
type Receipt = { tenant: string; hash: string; code: number };
type Db = {
  receipts: Map<string, Receipt>;
  optOuts: Set<string>;
  outbound: Map<string, DeliveryState>;
};
const cloneDb = (d: Db): Db => ({
  receipts: new Map(d.receipts), optOuts: new Set(d.optOuts),
  outbound: new Map([...d.outbound].map(([k, v]) => [k, { ...v }])),
});

/** Mirrors gateway_process_command: per-key lock (PK row lock), all-or-nothing commit. */
function txStore(links: Record<string, TenantLink>, opts: { crashAfterEffect?: () => boolean; delayMs?: number } = {}) {
  let db: Db = { receipts: new Map(), optOuts: new Set(), outbound: new Map() };
  const locks = new Map<string, Promise<void>>();
  let effectsCommitted = 0;
  const store: ReceiverStore = {
    async resolveTenant(t) { return links[t] ?? null; },
    async processOnce(salonId, rc: ReceiptKey, effect: Effect): Promise<ProcessOutcome> {
      const prev = locks.get(rc.idempotencyKey) ?? Promise.resolve();
      let release!: () => void;
      const mine = new Promise<void>((r) => (release = r));
      locks.set(rc.idempotencyKey, prev.then(() => mine));
      await prev;
      try {
        const tx = cloneDb(db);
        const ex = tx.receipts.get(rc.idempotencyKey);
        if (ex) {
          return ex.hash === rc.requestHash && ex.tenant === rc.tenantId
            ? { result: "duplicate", storedCode: ex.code, storedBody: {} } : { result: "conflict" };
        }
        let out: ProcessOutcome = { result: "applied" };
        if (effect.kind === "opt_out") {
          const k = `${salonId}|${effect.contactRef}`;
          if (tx.optOuts.has(k)) out = { result: "accepted_noop" }; else tx.optOuts.add(k);
        } else if (effect.kind === "delivery_status") {
          const k = `${salonId}|${effect.outboundRef}`;
          const cur = tx.outbound.get(k);
          if (!cur) out = { result: "business_rejected", reason: "unknown_outbound_ref" };
          else {
            const t = nextDeliveryState(cur, effect.status);
            if (t.changed) tx.outbound.set(k, t.next); else out = { result: "accepted_noop" };
          }
        } else {
          out = { result: "accepted_noop" };
        }
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        if (opts.crashAfterEffect?.()) throw new Error("simulated crash before commit");
        const code = out.result === "applied" ? 200 : out.result === "accepted_noop" ? 202 : 422;
        tx.receipts.set(rc.idempotencyKey, { tenant: rc.tenantId, hash: rc.requestHash, code });
        db = tx; // commit
        if (out.result === "applied") effectsCommitted++;
        return out;
      } finally {
        release();
      }
    },
  };
  return {
    store,
    get db() { return db; },
    seedOutbound(salon: string, ref: string, s: DeliveryState = { status: null, failedAttempts: 0 }) { db.outbound.set(`${salon}|${ref}`, s); },
    get effects() { return effectsCommitted; },
  };
}

const ALL: ActionType[] = ["opt_out_signal", "inbound_message_record", "delivery_status_record", "confirmation_token_received"];
const LINKS: Record<string, TenantLink> = {
  tenant_a: { salonId: SALON_A, enabled: true, allowedActionTypes: ALL },
  tenant_b: { salonId: SALON_B, enabled: true, allowedActionTypes: ALL },
};
const SIGN_KEY = "fictief-signing-key-0123456789abcdef0123456";
const NOW = 1_791_576_000;
const cfg = { enabled: true, keys: { k1: SIGN_KEY }, contactRefVersions: ["v1", "v2"] };
let seq = 0;
const newKey = () => (++seq).toString(16).padStart(64, "0");

const cmd = (o: Record<string, unknown>) => ({
  contract_version: 1, idempotency_key: newKey(), tenant_id: "tenant_a", action_type: "opt_out_signal",
  provider_event_id: "msg:wamid.FICT", occurred_at: "2026-10-09T20:00:00Z", data: {}, ...o,
});
async function send(store: ReceiverStore, body: Record<string, unknown>, c = cfg, sigOverride?: string) {
  const raw = JSON.stringify(body); const ts = String(NOW);
  const sig = sigOverride ?? (await signV1("k1", SIGN_KEY, ts, "POST", COMMAND_PATH, raw));
  return handleGatewayCommand(c, store, {
    method: "POST", path: COMMAND_PATH, rawBody: raw,
    headers: { "x-gs-key-id": "k1", "x-gs-timestamp": ts, "x-gs-nonce": body.idempotency_key as string, "x-gs-signature": sig },
  }, NOW);
}
const stopCmd = async (tenant: string, ref: string | null, extra: Record<string, unknown> = {}) =>
  cmd({ tenant_id: tenant, data: { channel: "whatsapp", contact_ref: ref }, ...extra });

// ---------------- A. contact refs ----------------
describe("A. contact_ref derivation", () => {
  it("normalises equivalent NL forms to one E.164", () => {
    for (const f of ["+31612345678", "0612345678", "06-12 34 56 78", "0031612345678", "31612345678"]) {
      expect(normalizeE164(f)).toBe(PHONE);
    }
  });
  it("ambiguous numbers give no ref", async () => {
    expect(normalizeE164("612345678")).toBeNull();
    expect(normalizeE164("hello")).toBeNull();
    expect(await computeContactRef(MASTER_V1, "v1", "tenant_a", "612345678")).toBeNull();
  });
  it("Gateway form (wa_id) and GlowSuite form give the same ref", async () => {
    expect(await computeContactRef(MASTER_V1, "v1", "tenant_a", "31612345678"))
      .toBe(await computeContactRef(MASTER_V1, "v1", "tenant_a", "06 12345678"));
  });
  it("same number in another tenant gives a different ref", async () => {
    expect(await computeContactRef(MASTER_V1, "v1", "tenant_a", PHONE))
      .not.toBe(await computeContactRef(MASTER_V1, "v1", "tenant_b", PHONE));
  });
  it("ref contains no phone digits and parses", async () => {
    const r = (await computeContactRef(MASTER_V1, "v1", "tenant_a", PHONE))!;
    expect(r).not.toContain("612345678");
    expect(parseContactRef(r)).toMatchObject({ version: "v1" });
  });
  it("short master key refused", async () => {
    expect(await computeContactRef(new Uint8Array(31), "v1", "tenant_a", PHONE)).toBeNull();
  });
});

describe("A. STOP via receiver (simulated store)", () => {
  it("1. correct STOP at the same salon blocks sends there", async () => {
    const s = txStore(LINKS);
    const ref = (await computeContactRef(MASTER_V1, "v1", "tenant_a", PHONE))!;
    expect((await send(s.store, await stopCmd("tenant_a", ref))).body.code).toBe("applied");
    const isOut = async (refs: string[]) => refs.some((r) => s.db.optOuts.has(`${SALON_A}|${r}`));
    expect(await checkStopBeforeSend({ v1: MASTER_V1 }, "tenant_a", "0612345678", isOut)).toEqual({ blocked: true, reason: "stopped" });
  });
  it("2. ref of salon A sent under tenant B never blocks salon A, and never matches B's number", async () => {
    const s = txStore(LINKS);
    const refA = (await computeContactRef(MASTER_V1, "v1", "tenant_a", PHONE))!;
    await send(s.store, await stopCmd("tenant_b", refA));
    const isOutA = async (refs: string[]) => refs.some((r) => s.db.optOuts.has(`${SALON_A}|${r}`));
    const isOutB = async (refs: string[]) => refs.some((r) => s.db.optOuts.has(`${SALON_B}|${r}`));
    expect(await checkStopBeforeSend({ v1: MASTER_V1 }, "tenant_a", PHONE, isOutA)).toEqual({ blocked: false });
    expect(await checkStopBeforeSend({ v1: MASTER_V1 }, "tenant_b", PHONE, isOutB)).toEqual({ blocked: false });
  });
  it("2b. disabled tenant STOP is refused", async () => {
    const s = txStore({ tenant_a: { ...LINKS.tenant_a, enabled: false } });
    const ref = (await computeContactRef(MASTER_V1, "v1", "tenant_a", PHONE))!;
    expect((await send(s.store, await stopCmd("tenant_a", ref))).status).toBe(403);
  });
  it("3. unknown (never-messaged) number is still recorded, no customer lookup", async () => {
    const s = txStore(LINKS);
    const ref = (await computeContactRef(MASTER_V1, "v1", "tenant_a", "+31699999999"))!;
    expect((await send(s.store, await stopCmd("tenant_a", ref))).body.code).toBe("applied");
    expect(s.db.optOuts.size).toBe(1);
  });
  it("4. wrong or missing contact_ref is rejected", async () => {
    const s = txStore(LINKS);
    for (const bad of [null, "", "31612345678", "+31612345678", "c1.v1.xyz", `c1.v9.${"a".repeat(64)}`, `c2.v1.${"a".repeat(64)}`]) {
      expect((await send(s.store, await stopCmd("tenant_a", bad as any))).body.code).toBe("invalid_command");
    }
    expect(s.db.optOuts.size).toBe(0);
  });
  it("5. duplicate STOP: same key = duplicate, new key = accepted_noop, one row", async () => {
    const s = txStore(LINKS);
    const ref = (await computeContactRef(MASTER_V1, "v1", "tenant_a", PHONE))!;
    const c1 = await stopCmd("tenant_a", ref);
    expect((await send(s.store, c1)).body.code).toBe("applied");
    expect((await send(s.store, c1)).body.code).toBe("duplicate");
    expect((await send(s.store, await stopCmd("tenant_a", ref))).body.code).toBe("accepted_noop");
    expect(s.db.optOuts.size).toBe(1);
  });
  it("key rotation: STOP under v1 still blocks after v2 is added", async () => {
    const s = txStore(LINKS);
    await send(s.store, await stopCmd("tenant_a", (await computeContactRef(MASTER_V1, "v1", "tenant_a", PHONE))!));
    const isOut = async (refs: string[]) => refs.some((r) => s.db.optOuts.has(`${SALON_A}|${r}`));
    expect(await checkStopBeforeSend({ v1: MASTER_V1, v2: MASTER_V2 }, "tenant_a", PHONE, isOut)).toMatchObject({ blocked: true });
  });
  it("send-time check fails closed on ambiguous number or missing keys", async () => {
    const none = async () => false;
    expect(await checkStopBeforeSend({ v1: MASTER_V1 }, "tenant_a", "612345678", none)).toMatchObject({ blocked: true, reason: "number_not_normalisable" });
    expect(await checkStopBeforeSend({}, "tenant_a", PHONE, none)).toMatchObject({ blocked: true, reason: "no_contact_ref_keys" });
  });
});

// ---------------- B. delivery status ----------------
const run = (seqs: DeliveryStatus[]) =>
  seqs.reduce<DeliveryState>((s, e) => nextDeliveryState(s, e).next, { status: null, failedAttempts: 0 });

describe("B. delivery status state machine", () => {
  it("6. delayed callbacks: read then delivered then sent stays read", () => {
    expect(run(["read", "delivered", "sent"]).status).toBe("read");
  });
  it("7. failed after delivered/read keeps proof of delivery, counts attempt, flags conflict", () => {
    const t = nextDeliveryState({ status: "read", failedAttempts: 0 }, "failed");
    expect(t).toMatchObject({ next: { status: "read", failedAttempts: 1 }, conflict: true });
    expect(run(["sent", "delivered", "failed"]).status).toBe("delivered");
  });
  it("failed then delivered upgrades (proof wins), sent after failed does not", () => {
    expect(run(["sent", "failed", "delivered"])).toEqual({ status: "delivered", failedAttempts: 1 });
    expect(run(["failed", "sent"]).status).toBe("failed");
  });
  it("8. duplicates are no-ops; every permutation of {sent,delivered,read} ends at read", () => {
    expect(nextDeliveryState({ status: "delivered", failedAttempts: 0 }, "delivered").changed).toBe(false);
    const perms = [["sent","delivered","read"],["sent","read","delivered"],["delivered","sent","read"],["delivered","read","sent"],["read","sent","delivered"],["read","delivered","sent"]] as DeliveryStatus[][];
    for (const p of perms) expect(run(p).status).toBe("read");
    expect(run(["read", "failed", "failed", "read"])).toEqual({ status: "read", failedAttempts: 2 });
  });
  it("status via receiver is bound to salon + outbound_ref", async () => {
    const s = txStore(LINKS);
    s.seedOutbound(SALON_A, "out_ref_fictief_0001");
    const st = (tenant: string, status: string) =>
      cmd({ tenant_id: tenant, action_type: "delivery_status_record", data: { outbound_ref: "out_ref_fictief_0001", status } });
    expect((await send(s.store, st("tenant_a", "delivered"))).body.code).toBe("applied");
    expect((await send(s.store, st("tenant_b", "failed"))).status).toBe(422); // B has no such message
    expect((await send(s.store, st("tenant_a", "failed"))).body.code).toBe("applied");
    expect(s.db.outbound.get(`${SALON_A}|out_ref_fictief_0001`)).toEqual({ status: "delivered", failedAttempts: 1 });
    expect((await send(s.store, st("tenant_a", "sent"))).body.code).toBe("accepted_noop");
  });
});

// ---------------- C. transactional behaviour (simulated) ----------------
describe("C. idempotency under concurrency and crashes (simulated, not a DB test)", () => {
  it("9. concurrent identical commands: one applied, rest duplicate, one effect", async () => {
    const s = txStore(LINKS, { delayMs: 5 });
    const ref = (await computeContactRef(MASTER_V1, "v1", "tenant_a", PHONE))!;
    const c1 = await stopCmd("tenant_a", ref);
    const res = await Promise.all(Array.from({ length: 5 }, () => send(s.store, c1)));
    expect(res.filter((r) => r.body.code === "applied")).toHaveLength(1);
    expect(res.filter((r) => r.body.code === "duplicate")).toHaveLength(4);
    expect(s.effects).toBe(1);
  });
  it("10. concurrent same key, different content: one applied, other 409", async () => {
    const s = txStore(LINKS, { delayMs: 5 });
    const k = newKey();
    const r1 = (await computeContactRef(MASTER_V1, "v1", "tenant_a", PHONE))!;
    const r2 = (await computeContactRef(MASTER_V1, "v1", "tenant_a", "+31687654321"))!;
    const [a, b] = await Promise.all([
      send(s.store, await stopCmd("tenant_a", r1, { idempotency_key: k })),
      send(s.store, await stopCmd("tenant_a", r2, { idempotency_key: k })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(s.db.optOuts.size).toBe(1);
  });
  it("same key reused by another tenant is a conflict", async () => {
    const s = txStore(LINKS);
    const k = newKey();
    await send(s.store, await stopCmd("tenant_a", (await computeContactRef(MASTER_V1, "v1", "tenant_a", PHONE))!, { idempotency_key: k }));
    const r = await send(s.store, await stopCmd("tenant_b", (await computeContactRef(MASTER_V1, "v1", "tenant_b", PHONE))!, { idempotency_key: k }));
    expect(r.status).toBe(409);
  });
  it("11. crash before commit: no receipt, no effect; retry applies once", async () => {
    let crash = true;
    const s = txStore(LINKS, { crashAfterEffect: () => { const c = crash; crash = false; return c; } });
    const c1 = await stopCmd("tenant_a", (await computeContactRef(MASTER_V1, "v1", "tenant_a", PHONE))!);
    expect((await send(s.store, c1)).status).toBe(503);
    expect(s.db.receipts.size).toBe(0);
    expect(s.db.optOuts.size).toBe(0);
    expect((await send(s.store, c1)).body.code).toBe("applied");
    expect((await send(s.store, c1)).body.code).toBe("duplicate");
    expect(s.db.optOuts.size).toBe(1);
  });
});

// ---------------- other checks ----------------
describe("12. signature and consent", () => {
  it("bad signature rejected before any write", async () => {
    const s = txStore(LINKS);
    const c1 = await stopCmd("tenant_a", (await computeContactRef(MASTER_V1, "v1", "tenant_a", PHONE))!);
    expect((await send(s.store, c1, cfg, "v1=" + "0".repeat(64))).body.code).toBe("bad_signature");
    expect(s.db.receipts.size).toBe(0);
  });
  it("missing WhatsApp consent blocks; marketing needs separate consent", () => {
    const base = { user_id: SALON_A, phone: PHONE };
    expect(evaluateWhatsAppConsent({ purpose: "transactional", tenantId: SALON_A, customer: { ...base }, stoppedInTenant: false }).allowed).toBe(false);
    expect(evaluateWhatsAppConsent({ purpose: "marketing", tenantId: SALON_A, customer: { ...base, whatsapp_opt_in: true }, stoppedInTenant: false }).allowed).toBe(false);
  });
  it("confirmation tokens are not executed (422, no receipt)", async () => {
    const s = txStore(LINKS);
    const r = await send(s.store, cmd({ action_type: "confirmation_token_received", data: { token: "tok_fictief_0123456789", choice: "attend" } }));
    expect(r).toMatchObject({ status: 422, body: { reason: "confirmation_not_enabled" } });
    expect(s.db.receipts.size).toBe(0);
  });
  it("HMAC base string matches Gateway contract section 2", () => {
    const contract = "{key_id}.{timestamp}.{METHOD}.{path}.{sha256(body)}";
    const src = readFileSync("supabase/functions/_shared/inactive/gatewayReceiver.ts", "utf8");
    expect(contract).toBeTruthy();
    expect(src).toContain("`${keyId}.${ts}.${method.toUpperCase()}.${path}.${await sha256Hex(rawBody)}`");
  });
});

describe("13. everything stays inactive", () => {
  it("receiver is off unless the flag is exactly on", async () => {
    const s = txStore(LINKS);
    const c1 = await stopCmd("tenant_a", (await computeContactRef(MASTER_V1, "v1", "tenant_a", PHONE))!);
    expect((await send(s.store, c1, { ...cfg, enabled: false })).status).toBe(503);
  });
  it("active send and reminder code is unchanged in its consent rule", () => {
    expect(readFileSync("supabase/functions/_shared/reminderEngine.ts", "utf8")).toContain("c.whatsapp_opt_in !== false");
    expect(readFileSync("supabase/functions/whatsapp-send/index.ts", "utf8")).not.toMatch(/inactive\//);
  });
  it("SQL proposal: receipt inserted before effect, retention >= 400, no advisory-lock shortcut", () => {
    const sql = readFileSync("docs/proposed-migrations/2026-10-09_whatsapp_gateway_receiver.sql", "utf8");
    expect(sql.indexOf("'processing', 0)")).toBeLessThan(sql.indexOf("insert into whatsapp_opt_outs"));
    expect(sql).toMatch(/_keep_days < 400/);
    expect(sql).not.toMatch(/pg_advisory_xact_lock/);
    expect(sql).not.toMatch(/when 'failed' then 4/);
  });
});
