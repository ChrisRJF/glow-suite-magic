// INACTIVE. Tenant-scoped, keyed contact reference for WhatsApp STOP signals.
//
// Chosen method (see CONTRACT-ADDENDUM.md): keyed HMAC of the normalised phone
// number, with a key derived per Gateway tenant. Both sides can compute it
// from data they already hold (Gateway: inbound wa_id + receiving tenant;
// GlowSuite: destination number at send time), so no new customer mapping is
// invented. GlowSuite never needs to store the phone number of a STOP.
//
// Format: "c1.<key_version>.<64 hex>"
//   tenant_key = HMAC-SHA256(master[key_version], "glowsuite-contact-ref:v1:" + tenant_id)
//   ref        = HMAC-SHA256(tenant_key, normalised_e164)

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function hmac(key: string | ArrayBuffer, msg: string): Promise<ArrayBuffer> {
  const raw: BufferSource = typeof key === "string" ? enc.encode(key) : key;
  const k = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}

export const CONTACT_REF_RE = /^c1\.([a-z0-9]{1,16})\.([0-9a-f]{64})$/;

/**
 * Strict normalisation shared with the Gateway. Mirrors whatsapp-send's NL
 * rule (leading 0 -> +31) but refuses anything ambiguous instead of guessing,
 * so a send can fail closed rather than miss a STOP.
 */
export function normalizeE164(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.replace(/[\s().-]/g, "");
  let out: string;
  if (/^\+\d+$/.test(s)) out = s;
  else if (/^00\d+$/.test(s)) out = "+" + s.slice(2);
  else if (/^0\d{9}$/.test(s)) out = "+31" + s.slice(1);
  else if (/^31\d{9}$/.test(s)) out = "+" + s; // Meta wa_id form for NL
  else return null;
  return /^\+[1-9]\d{7,14}$/.test(out) ? out : null;
}

export async function computeContactRef(
  masterKey: string, keyVersion: string, tenantId: string, phone: unknown,
): Promise<string | null> {
  const e164 = normalizeE164(phone);
  if (!e164 || !masterKey || masterKey.length < 32 || !/^[a-z0-9]{1,16}$/.test(keyVersion) || !tenantId) return null;
  const tenantKey = await hmac(masterKey, `glowsuite-contact-ref:v1:${tenantId}`);
  return `c1.${keyVersion}.${hex(await hmac(tenantKey, e164))}`;
}

export function parseContactRef(ref: unknown): { version: string; digest: string } | null {
  if (typeof ref !== "string") return null;
  const m = CONTACT_REF_RE.exec(ref);
  return m ? { version: m[1], digest: m[2] } : null;
}

export type SendStopCheck =
  | { blocked: false }
  | { blocked: true; reason: "stopped" | "number_not_normalisable" | "no_contact_ref_keys" };

/**
 * Send-time check, for the future wiring into whatsapp-send. Computes the ref
 * under EVERY active key version (rotation) and blocks if any is opted out in
 * this salon. Ambiguous numbers and missing keys fail closed.
 */
export async function checkStopBeforeSend(
  keys: Record<string, string | undefined>,
  tenantId: string,
  phone: unknown,
  isOptedOut: (refs: string[]) => Promise<boolean>,
): Promise<SendStopCheck> {
  const versions = Object.entries(keys).filter(([, k]) => k && k.length >= 32);
  if (versions.length === 0) return { blocked: true, reason: "no_contact_ref_keys" };
  if (!normalizeE164(phone)) return { blocked: true, reason: "number_not_normalisable" };
  const refs: string[] = [];
  for (const [v, k] of versions) {
    const r = await computeContactRef(k!, v, tenantId, phone);
    if (r) refs.push(r);
  }
  return (await isOptedOut(refs)) ? { blocked: true, reason: "stopped" } : { blocked: false };
}
