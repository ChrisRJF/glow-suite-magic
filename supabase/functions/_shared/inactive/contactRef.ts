// INACTIVE. Tenant-scoped, keyed contact reference for WhatsApp STOP signals.
// Round 6: aligned with the Gateway round-5 spec (contact-ref.ts / stop-signal.ts
// / contact-ref-test-vectors.json). The Gateway source was NOT read directly;
// alignment is proven only against the fixed test vectors in src/test.
//
//   tenant_key  = HMAC-SHA256(master_key_bytes, "glowsuite-contact-ref:v1:" + gateway_tenant_id)
//   digest      = HMAC-SHA256(tenant_key, normalized_e164)
//   contact_ref = "c1." + key_version + "." + lowercase_hex(digest)
//
// gateway_tenant_id is the verified EXTERNAL Gateway tenant id, never the
// internal GlowSuite salon id. The mapping must come from an authorised tenant
// link; when it is missing the caller must refuse (see gatewayReceiver.ts).
//
// Key config format (same as Gateway): {"current":"1","keys":{"1":"<Base64>"}}
// Each key must decode (canonical Base64) to >= 32 raw bytes. Plain text keys
// are refused. Keys are never logged.

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export const KEY_VERSION_RE = /^[a-z0-9]{1,16}$/;
export const CONTACT_REF_RE = /^c1\.([a-z0-9]{1,16})\.([0-9a-f]{64})$/;
export const MIN_KEY_BYTES = 32;

async function hmacBytes(key: Uint8Array | ArrayBuffer, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}

const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Strict canonical Base64 -> bytes. Returns null for anything else. */
export function decodeBase64Strict(s: unknown): Uint8Array | null {
  if (typeof s !== "string" || s.length === 0 || !B64_RE.test(s)) return null;
  let bin: string;
  try { bin = atob(s); } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  // Canonical check: re-encoding must give the exact input (rejects non-zero pad bits).
  if (btoa(bin) !== s) return null;
  return out;
}

export interface KeyRing {
  current: string;
  /** version -> raw key bytes (>= 32). */
  keys: Record<string, Uint8Array>;
}

export type KeyRingResult = { ok: true; ring: KeyRing } | { ok: false; reason: string };

/** Parses {"current":"1","keys":{"1":"<Base64>"}}. Fails closed; error never contains key material. */
export function parseKeyRing(raw: unknown): KeyRingResult {
  if (typeof raw !== "string" || !raw) return { ok: false, reason: "missing_config" };
  let p: unknown;
  try { p = JSON.parse(raw); } catch { return { ok: false, reason: "bad_json" }; }
  if (!p || typeof p !== "object" || Array.isArray(p)) return { ok: false, reason: "bad_shape" };
  const o = p as Record<string, unknown>;
  if (Object.keys(o).some((k) => k !== "current" && k !== "keys")) return { ok: false, reason: "unknown_fields" };
  if (typeof o.current !== "string" || !KEY_VERSION_RE.test(o.current)) return { ok: false, reason: "bad_current" };
  if (!o.keys || typeof o.keys !== "object" || Array.isArray(o.keys)) return { ok: false, reason: "bad_keys" };
  const keys: Record<string, Uint8Array> = {};
  for (const [v, b64] of Object.entries(o.keys as Record<string, unknown>)) {
    if (!KEY_VERSION_RE.test(v)) return { ok: false, reason: "bad_version" };
    const bytes = decodeBase64Strict(b64);
    if (!bytes) return { ok: false, reason: "bad_base64" };
    if (bytes.length < MIN_KEY_BYTES) return { ok: false, reason: "key_too_short" };
    keys[v] = bytes;
  }
  if (!keys[o.current]) return { ok: false, reason: "current_missing" };
  return { ok: true, ring: { current: o.current, keys } };
}

export const MAX_PHONE_INPUT_CHARS = 40;
const ALLOWED = /^[0-9+ \-.()]+$/; // ASCII space, hyphen, dot, parentheses only

/**
 * Strict normalisation (Gateway rules). Shape check only: a valid E.164 form
 * does NOT prove the number exists or is on WhatsApp.
 * Accepts: NL mobile 06xxxxxxxx, 316xxxxxxxx (wa_id form), 00<cc>..., +<cc>...
 * Refuses: tabs, NBSP, letters, NL landlines without country code, short/long numbers.
 */
export function normalizeE164(input: unknown): string | null {
  if (typeof input !== "string") return null;
  if (input.length > MAX_PHONE_INPUT_CHARS) return null; // checked BEFORE separators are stripped
  if (!ALLOWED.test(input)) return null;
  const plusCount = (input.match(/\+/g) ?? []).length;
  if (plusCount > 1 || (plusCount === 1 && !input.startsWith("+"))) return null;
  const s = input.replace(/[ \-.()]/g, "");
  let out: string;
  if (/^\+\d+$/.test(s)) out = s;
  else if (/^00\d+$/.test(s)) out = "+" + s.slice(2);
  else if (/^06\d{8}$/.test(s)) out = "+31" + s.slice(1);
  else if (/^316\d{8}$/.test(s)) out = "+" + s;
  else return null;
  if (!/^\+[1-9]\d{7,14}$/.test(out)) return null;
  if (out.startsWith("+31") && !/^\+31\d{9}$/.test(out)) return null; // NL numbers are +31 + 9 digits
  return out;
}

/** masterKey must be raw bytes (from parseKeyRing). Strings are refused. */
export async function computeContactRef(
  masterKey: Uint8Array, keyVersion: string, gatewayTenantId: string, phone: unknown,
): Promise<string | null> {
  if (!(masterKey instanceof Uint8Array) || masterKey.length < MIN_KEY_BYTES) return null;
  if (!KEY_VERSION_RE.test(keyVersion) || typeof gatewayTenantId !== "string" || !gatewayTenantId) return null;
  const e164 = normalizeE164(phone);
  if (!e164) return null;
  const tenantKey = await hmacBytes(masterKey, `glowsuite-contact-ref:v1:${gatewayTenantId}`);
  return `c1.${keyVersion}.${hex(await hmacBytes(tenantKey, e164))}`;
}

/** New STOP refs always use the current version. */
export function computeCurrentContactRef(ring: KeyRing, gatewayTenantId: string, phone: unknown) {
  return computeContactRef(ring.keys[ring.current], ring.current, gatewayTenantId, phone);
}

export function parseContactRef(ref: unknown): { version: string; digest: string } | null {
  if (typeof ref !== "string") return null;
  const m = CONTACT_REF_RE.exec(ref);
  return m ? { version: m[1], digest: m[2] } : null;
}

export type SendStopCheck =
  | { blocked: false }
  | { blocked: true; reason: "stopped" | "number_not_normalisable" | "no_contact_ref_keys" | "invalid_contact_ref_keys" | "tenant_not_mapped" | "stop_lookup_failed" };

/**
 * Send-time check. Computes the ref under EVERY valid key version so older
 * STOPs keep blocking after rotation. gatewayTenantId must come from an
 * authorised mapping; null/empty fails closed.
 */
export async function checkStopBeforeSend(
  keys: Record<string, Uint8Array | undefined> | null | undefined,
  gatewayTenantId: string | null | undefined,
  phone: unknown,
  isOptedOut: (refs: string[]) => Promise<boolean>,
): Promise<SendStopCheck> {
  if (!gatewayTenantId) return { blocked: true, reason: "tenant_not_mapped" };
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) return { blocked: true, reason: "no_contact_ref_keys" };
  const entries = Object.entries(keys);
  if (entries.length === 0) return { blocked: true, reason: "no_contact_ref_keys" };
  // Every supplied version must be valid; one bad entry blocks the whole send
  // (never continue with only the remaining valid keys).
  for (const [v, k] of entries) {
    if (!KEY_VERSION_RE.test(v) || !(k instanceof Uint8Array) || k.length < MIN_KEY_BYTES) {
      return { blocked: true, reason: "invalid_contact_ref_keys" };
    }
  }
  if (!normalizeE164(phone)) return { blocked: true, reason: "number_not_normalisable" };
  const refs: string[] = [];
  for (const [v, k] of entries) {
    const r = await computeContactRef(k as Uint8Array, v, gatewayTenantId, phone);
    if (!r) return { blocked: true, reason: "invalid_contact_ref_keys" };
    refs.push(r);
  }
  let stopped: unknown;
  try { stopped = await isOptedOut(refs); } catch { return { blocked: true, reason: "stop_lookup_failed" }; }
  if (stopped !== false) return stopped === true ? { blocked: true, reason: "stopped" } : { blocked: true, reason: "stop_lookup_failed" };
  return { blocked: false };
}
