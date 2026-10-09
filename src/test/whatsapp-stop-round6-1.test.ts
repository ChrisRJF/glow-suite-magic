// Round 6.1: phone input length limit + fail-closed key config in checkStopBeforeSend.
// Fictitious data only, no DB, no network.
import { describe, it, expect, vi } from "vitest";
import {
  normalizeE164, parseKeyRing, checkStopBeforeSend, computeContactRef, MAX_PHONE_INPUT_CHARS,
} from "../../supabase/functions/_shared/inactive/contactRef";

const K1 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const K2 = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=";
const ring = () => {
  const r = parseKeyRing(JSON.stringify({ current: "2", keys: { "1": K1, "2": K2 } }));
  if (r.ok === false) throw new Error(r.reason);
  return r.ring;
};
const PHONE = "+31612345678";
const pad = (core: string, len: number) => core + " ".repeat(len - core.length);

describe("A. phone input length (max 40 chars, checked before stripping)", () => {
  it("limit is 40", () => expect(MAX_PHONE_INPUT_CHARS).toBe(40));
  it("accepts exactly 40 chars incl. allowed separators", () => {
    const s = pad("+31 6-12.34(56)78", 40);
    expect(s.length).toBe(40);
    expect(normalizeE164(s)).toBe(PHONE);
  });
  it("refuses 41 chars even though stripped form is valid", () => {
    const s = pad("+31 6-12.34(56)78", 41);
    expect(s.length).toBe(41);
    expect(normalizeE164(s)).toBeNull();
    expect(normalizeE164(pad("0612345678", 41))).toBeNull();
    expect(normalizeE164("-".repeat(31) + "0612345678")).toBeNull();
  });
  it("40 chars of separators + digits around a 06 number still works", () => {
    const s = "-".repeat(30) + "0612345678";
    expect(s.length).toBe(40);
    expect(normalizeE164(s)).toBe(PHONE);
  });
  it("non-strings refused; existing formats still work; ambiguous still refused", () => {
    expect(normalizeE164(31612345678 as unknown)).toBeNull();
    expect(normalizeE164(null)).toBeNull();
    expect(normalizeE164("06 12345678")).toBe(PHONE);
    expect(normalizeE164("0031612345678")).toBe(PHONE);
    expect(normalizeE164("31612345678")).toBe(PHONE);
    expect(normalizeE164("+49 151 23456789")).toBe("+4915123456789");
    expect(normalizeE164("0201234567")).toBeNull();
    expect(normalizeE164("612345678")).toBeNull();
    expect(normalizeE164("+31+612345678")).toBeNull();
  });
});

describe("B. checkStopBeforeSend fails closed on any bad key", () => {
  const no = async () => false;
  it("mixed valid + invalid version blocks", async () => {
    const r = ring();
    expect(await checkStopBeforeSend({ ...r.keys, "BAD!": r.keys["1"] }, "tenant-test-a", PHONE, no))
      .toEqual({ blocked: true, reason: "invalid_contact_ref_keys" });
  });
  it("too-short key blocks even with other valid keys", async () => {
    expect(await checkStopBeforeSend({ ...ring().keys, "3": new Uint8Array(31) }, "tenant-test-a", PHONE, no))
      .toEqual({ blocked: true, reason: "invalid_contact_ref_keys" });
  });
  it("missing (undefined) key for a listed version blocks", async () => {
    expect(await checkStopBeforeSend({ ...ring().keys, "3": undefined }, "tenant-test-a", PHONE, no))
      .toEqual({ blocked: true, reason: "invalid_contact_ref_keys" });
  });
  it("non-bytes key blocks", async () => {
    expect(await checkStopBeforeSend({ "1": "x".repeat(64) as unknown as Uint8Array }, "tenant-test-a", PHONE, no))
      .toEqual({ blocked: true, reason: "invalid_contact_ref_keys" });
  });
  it("invalid key never reaches lookup with remaining keys", async () => {
    const spy = vi.fn(async () => false);
    await checkStopBeforeSend({ ...ring().keys, "x": new Uint8Array(5) }, "tenant-test-a", PHONE, spy);
    expect(spy).not.toHaveBeenCalled();
  });
  it("missing config / tenant mapping blocks", async () => {
    expect(await checkStopBeforeSend(null, "tenant-test-a", PHONE, no)).toMatchObject({ blocked: true, reason: "no_contact_ref_keys" });
    expect(await checkStopBeforeSend({}, "tenant-test-a", PHONE, no)).toMatchObject({ blocked: true, reason: "no_contact_ref_keys" });
    expect(await checkStopBeforeSend(ring().keys, null, PHONE, no)).toEqual({ blocked: true, reason: "tenant_not_mapped" });
  });
  it("STOP lookup failure blocks (throw or non-boolean)", async () => {
    expect(await checkStopBeforeSend(ring().keys, "tenant-test-a", PHONE, async () => { throw new Error("db down"); }))
      .toEqual({ blocked: true, reason: "stop_lookup_failed" });
    expect(await checkStopBeforeSend(ring().keys, "tenant-test-a", PHONE, async () => undefined as unknown as boolean))
      .toEqual({ blocked: true, reason: "stop_lookup_failed" });
  });
  it("old STOP under v1 still blocks after rotation to v2; all versions checked", async () => {
    const r = ring();
    const old = await computeContactRef(r.keys["1"], "1", "tenant-test-a", PHONE);
    const seen: string[][] = [];
    const res = await checkStopBeforeSend(r.keys, "tenant-test-a", "06-12345678", async (refs) => { seen.push(refs); return refs.includes(old!); });
    expect(res).toEqual({ blocked: true, reason: "stopped" });
    expect(seen[0]).toHaveLength(2);
    expect(await checkStopBeforeSend(r.keys, "tenant-test-a", PHONE, no)).toEqual({ blocked: false });
  });
});
