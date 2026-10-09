// Round 6: STOP compatibility with Gateway round 5. Fictitious data only, no DB, no network.
// Expected digests are FIXED constants from the spec, not recomputed with the code under test.
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import {
  computeContactRef, computeCurrentContactRef, normalizeE164, parseKeyRing, decodeBase64Strict,
  checkStopBeforeSend, parseContactRef,
} from "../../supabase/functions/_shared/inactive/contactRef";
import { isStopKeyword } from "../../supabase/functions/_shared/inactive/whatsappConsent";
import { handleGatewayCommand, signV1, COMMAND_PATH, type ReceiverStore } from "../../supabase/functions/_shared/inactive/gatewayReceiver";

const K1 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const K2 = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=";
const RING = JSON.stringify({ current: "2", keys: { "1": K1, "2": K2 } });
const ring = () => { const r = parseKeyRing(RING); if (!r.ok) throw new Error(r.reason); return r.ring; };

const VECTORS = [
  { tenant: "tenant-test-a", phone: "+31612345678", v: "1", hex: "54d32dc70c302bac4fa8614b919383d124e6cba859dc9ec71ea94a9c670bf5d1" },
  { tenant: "tenant-test-b", phone: "+31612345678", v: "1", hex: "4e10fd1b1755ec739ef10871d4dcf72672dff79a38bf256474929031c6fc9a0a" },
  { tenant: "tenant-test-a", phone: "+4915123456789", v: "1", hex: "25e8a2816e488e555e0c2d282f55187a0eb9b630996ca85c3bb82f02933a4886" },
  { tenant: "tenant-test-a", phone: "+31612345678", v: "2", hex: "9598b313a9e4816146b5fa231d75e09a6d85991e81eff57e37092583bb53b06e" },
];

describe("1. fixed HMAC vectors", () => {
  for (const [i, t] of VECTORS.entries()) {
    it(`vector ${i + 1}`, async () => {
      expect(await computeContactRef(ring().keys[t.v], t.v, t.tenant, t.phone)).toBe(`c1.${t.v}.${t.hex}`);
    });
  }
});

describe("2. same number, different salons", () => {
  it("differs per tenant", async () => {
    expect(VECTORS[0].hex).not.toBe(VECTORS[1].hex);
    const a = await computeContactRef(ring().keys["1"], "1", "tenant-test-a", "+31612345678");
    const b = await computeContactRef(ring().keys["1"], "1", "tenant-test-b", "+31612345678");
    expect(a).not.toBe(b);
  });
});

describe("3-5. normalisation", () => {
  it("five NL formats", () => {
    for (const f of ["0612345678", "06 12345678", "31612345678", "0031612345678", "+31612345678"]) expect(normalizeE164(f)).toBe("+31612345678");
  });
  it("international", () => {
    expect(normalizeE164("+49 151 23456789")).toBe("+4915123456789");
    expect(normalizeE164("+32 (470) 12.34.56")).toBe("+32470123456");
  });
  it("invalid / ambiguous / unexpected separators", () => {
    for (const bad of ["612345678", "0501234567", "4915123456789", "+31 6 1234567", "+316123456789",
      "06\t12345678", "06\u00a012345678", "06_12345678", "06/12345678", "+0612345678", "06+12345678",
      "++31612345678", "+123", "+1234567890123456", "", "abc", null, 31612345678]) {
      expect(normalizeE164(bad as any)).toBeNull();
    }
  });
});

describe("6-8. key config", () => {
  it("6. invalid / non-canonical Base64 refused", () => {
    expect(decodeBase64Strict("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")).toBeNull(); // no padding
    expect(decodeBase64Strict("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh9=")).toBeNull(); // non-zero pad bits
    expect(decodeBase64Strict("AAEC AwQF")).toBeNull();
    expect(decodeBase64Strict("AAEC-_==")).toBeNull(); // base64url
    for (const k of ["not base64!", "AAEC AwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="])
      expect(parseKeyRing(JSON.stringify({ current: "1", keys: { "1": k } }))).toEqual({ ok: false, reason: "bad_base64" });
  });
  it("6b. plain text key is never used", async () => {
    expect(parseKeyRing(JSON.stringify({ current: "1", keys: { "1": "fictief-tekstsleutel-0123456789abcdef0123" } })).ok).toBe(false);
    expect(await computeContactRef("fictief-tekstsleutel-0123456789abcdef0123" as any, "1", "tenant-test-a", "+31612345678")).toBeNull();
  });
  it("7. keys shorter than 32 bytes", async () => {
    const short = btoa(String.fromCharCode(...new Array(31).fill(7)));
    expect(parseKeyRing(JSON.stringify({ current: "1", keys: { "1": short } }))).toEqual({ ok: false, reason: "key_too_short" });
    expect(await computeContactRef(new Uint8Array(31), "1", "t", "+31612345678")).toBeNull();
  });
  it("8. missing config / current key / bad version", () => {
    for (const raw of [undefined, "", "{}", "[]", "nope", JSON.stringify({ current: "1", keys: {} }),
      JSON.stringify({ current: "1", keys: { "2": K2 } }), JSON.stringify({ current: "V1", keys: { V1: K1 } }),
      JSON.stringify({ current: "1", keys: { "1": K1 }, extra: 1 })]) {
      expect(parseKeyRing(raw).ok).toBe(false);
    }
  });
  it("8b. errors never contain key material", () => {
    const r = parseKeyRing(JSON.stringify({ current: "1", keys: { "1": "x" + K1 } }));
    expect(JSON.stringify(r)).not.toContain(K1.slice(0, 10));
  });
});

describe("9-10. rotation", () => {
  it("9. new STOP refs use the current version", async () => {
    expect(await computeCurrentContactRef(ring(), "tenant-test-a", "0612345678")).toBe(`c1.2.${VECTORS[3].hex}`);
  });
  it("10. old v1 STOP still blocks after rotation to v2", async () => {
    const stored = new Set([`c1.1.${VECTORS[0].hex}`]);
    const res = await checkStopBeforeSend(ring().keys, "tenant-test-a", "06-12345678", async (refs) => refs.some((r) => stored.has(r)));
    expect(res).toEqual({ blocked: true, reason: "stopped" });
    expect(parseContactRef(`c1.1.${VECTORS[0].hex}`)).toEqual({ version: "1", digest: VECTORS[0].hex });
  });
  it("other tenant's STOP does not block", async () => {
    const stored = new Set([`c1.1.${VECTORS[1].hex}`]);
    expect(await checkStopBeforeSend(ring().keys, "tenant-test-a", "+31612345678", async (refs) => refs.some((r) => stored.has(r)))).toEqual({ blocked: false });
  });
  it("fails closed without keys or number", async () => {
    const no = async () => false;
    expect(await checkStopBeforeSend({}, "tenant-test-a", "+31612345678", no)).toMatchObject({ reason: "no_contact_ref_keys" });
    expect(await checkStopBeforeSend(null, "tenant-test-a", "+31612345678", no)).toMatchObject({ reason: "no_contact_ref_keys" });
    expect(await checkStopBeforeSend(ring().keys, "tenant-test-a", "612345678", no)).toMatchObject({ reason: "number_not_normalisable" });
  });
});

describe("11-12. STOP words", () => {
  it("five words, any case, trimmed", () => {
    for (const w of ["STOP", "stoppen", " Afmelden ", "UITSCHRIJVEN", "unsubscribe\n"]) expect(isStopKeyword(w)).toBe(true);
  });
  it("free text is not STOP", () => {
    for (const t of ["Stop maar niet met mijn afspraken", "stop!", "STOP STOP", "afmelden graag", "", null]) expect(isStopKeyword(t as any)).toBe(false);
  });
});

describe("13. unknown tenant not auto-mapped", () => {
  it("send check refuses without mapped gateway tenant", async () => {
    expect(await checkStopBeforeSend(ring().keys, null, "+31612345678", async () => false)).toEqual({ blocked: true, reason: "tenant_not_mapped" });
    expect(await checkStopBeforeSend(ring().keys, "", "+31612345678", async () => false)).toEqual({ blocked: true, reason: "tenant_not_mapped" });
  });
  it("receiver refuses STOP for unknown tenant, store never written", async () => {
    const SK = "fictief-signing-key-0123456789abcdef0123456";
    const processOnce = vi.fn();
    const store: ReceiverStore = { resolveTenant: async () => null, processOnce };
    const body = JSON.stringify({ contract_version: 1, idempotency_key: "a".repeat(64), tenant_id: "tenant-unknown", action_type: "opt_out_signal",
      provider_event_id: "msg:wamid.FICT", occurred_at: "2026-10-09T20:00:00Z", data: { channel: "whatsapp", contact_ref: `c1.1.${VECTORS[0].hex}` } });
    const ts = "1791576000";
    const res = await handleGatewayCommand({ enabled: true, keys: { k1: SK }, contactRefVersions: ["1", "2"] }, store, {
      method: "POST", path: COMMAND_PATH, rawBody: body,
      headers: { "x-gs-key-id": "k1", "x-gs-timestamp": ts, "x-gs-nonce": "a".repeat(64), "x-gs-signature": await signV1("k1", SK, ts, "POST", COMMAND_PATH, body) },
    }, 1791576000);
    expect(res.status).toBe(403);
    expect(processOnce).not.toHaveBeenCalled();
  });
});

const INACTIVE = "supabase/functions/_shared/inactive";
const FUNCS = "supabase/functions";
describe("14-17. isolation", () => {
  it("14. inactive modules contain no logging", () => {
    for (const f of readdirSync(INACTIVE).filter((f) => f.endsWith(".ts")))
      expect(readFileSync(join(INACTIVE, f), "utf8")).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });
  it("14b. computing refs writes nothing to console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    await checkStopBeforeSend(ring().keys, "tenant-test-a", "+31612345678", async () => false);
    parseKeyRing("bad");
    for (const s of spies) { expect(s).not.toHaveBeenCalled(); s.mockRestore(); }
  });
  it("15. no active edge function imports inactive modules", () => {
    for (const d of readdirSync(FUNCS).filter((d) => d !== "_shared")) {
      const p = join(FUNCS, d, "index.ts");
      if (existsSync(p)) expect(readFileSync(p, "utf8")).not.toMatch(/inactive\//);
    }
    for (const f of readdirSync(join(FUNCS, "_shared")).filter((f) => f.endsWith(".ts")))
      expect(readFileSync(join(FUNCS, "_shared", f), "utf8")).not.toMatch(/inactive\//);
  });
  it("16. old whatsapp-inbound stays disabled", () => {
    const src = readFileSync(join(FUNCS, "whatsapp-inbound/index.ts"), "utf8");
    expect(src).not.toMatch(/from\(["']whatsapp|insert\(|twilio/i);
  });
  it("17. whatsapp-send and reminders do not use the new STOP code", () => {
    expect(readFileSync(join(FUNCS, "whatsapp-send/index.ts"), "utf8")).not.toMatch(/contactRef|checkStopBeforeSend/);
    const re = join(FUNCS, "_shared/reminderEngine.ts");
    if (existsSync(re)) expect(readFileSync(re, "utf8")).not.toMatch(/contactRef|checkStopBeforeSend/);
  });
});
