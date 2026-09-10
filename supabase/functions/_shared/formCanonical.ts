// Canonical serialization + validation for Klantdossier form submissions.
//
// The document hash MUST be reproducible: same answers + same published
// template version => same hash, forever. Therefore the canonical snapshot
// contains only signed content (template identity, ordered fields, answers,
// signer name). No timestamps, IPs or other variable metadata.

export type FieldType = "text" | "textarea" | "number" | "date" | "select" | "checkbox" | "radio";

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  max_length?: number;
}

export interface FormSchema {
  fields: FormField[];
  intro?: string;
}

const FIELD_TYPES: FieldType[] = ["text", "textarea", "number", "date", "select", "checkbox", "radio"];
const KEY_RE = /^[a-z0-9_]{1,48}$/;
const MAX_FIELDS = 60;
const MAX_TEXT = 2000;
const MAX_SIGNATURE_CHARS = 200_000; // ~150KB base64 PNG

/** Strip anything that could execute or be interpreted as markup. */
export function sanitizeText(value: string, max = MAX_TEXT): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[<>]/g, "")
    .slice(0, max)
    .trim();
}

export function validateSchema(input: unknown): { ok: true; schema: FormSchema } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "schema_invalid" };
  const raw = input as Record<string, unknown>;
  const fieldsRaw = raw.fields;
  if (!Array.isArray(fieldsRaw) || fieldsRaw.length === 0) return { ok: false, error: "schema_no_fields" };
  if (fieldsRaw.length > MAX_FIELDS) return { ok: false, error: "schema_too_many_fields" };

  const seen = new Set<string>();
  const fields: FormField[] = [];
  for (const f of fieldsRaw) {
    if (!f || typeof f !== "object") return { ok: false, error: "field_invalid" };
    const o = f as Record<string, unknown>;
    const key = String(o.key ?? "").trim();
    if (!KEY_RE.test(key)) return { ok: false, error: `field_key_invalid:${key.slice(0, 20)}` };
    if (seen.has(key)) return { ok: false, error: `field_key_duplicate:${key}` };
    seen.add(key);
    const type = String(o.type ?? "text") as FieldType;
    if (!FIELD_TYPES.includes(type)) return { ok: false, error: `field_type_invalid:${key}` };
    const label = sanitizeText(String(o.label ?? ""), 200);
    if (!label) return { ok: false, error: `field_label_required:${key}` };
    const field: FormField = { key, label, type, required: Boolean(o.required) };
    if (type === "select" || type === "radio") {
      const opts = Array.isArray(o.options) ? o.options.map((x) => sanitizeText(String(x), 120)).filter(Boolean) : [];
      if (opts.length === 0) return { ok: false, error: `field_options_required:${key}` };
      field.options = opts.slice(0, 30);
    }
    if (typeof o.max_length === "number" && o.max_length > 0) field.max_length = Math.min(o.max_length, MAX_TEXT);
    fields.push(field);
  }
  const schema: FormSchema = { fields };
  if (typeof raw.intro === "string") schema.intro = sanitizeText(raw.intro, 600);
  return { ok: true, schema };
}

export interface ValidatedAnswers {
  /** key -> normalized value, in schema field order */
  ordered: Array<{ key: string; label: string; type: FieldType; value: string | number | boolean | null }>;
  map: Record<string, string | number | boolean | null>;
}

export function validateAnswers(
  schema: FormSchema,
  input: unknown,
): { ok: true; answers: ValidatedAnswers } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "answers_invalid" };
  const raw = input as Record<string, unknown>;
  const ordered: ValidatedAnswers["ordered"] = [];
  const map: ValidatedAnswers["map"] = {};

  for (const field of schema.fields) {
    const rawValue = raw[field.key];
    let value: string | number | boolean | null = null;

    if (field.type === "checkbox") {
      value = Boolean(rawValue);
      if (field.required && value !== true) return { ok: false, error: `required:${field.key}` };
    } else if (rawValue === undefined || rawValue === null || rawValue === "") {
      if (field.required) return { ok: false, error: `required:${field.key}` };
      value = null;
    } else if (field.type === "number") {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) return { ok: false, error: `number:${field.key}` };
      value = n;
    } else if (field.type === "date") {
      const s = String(rawValue).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, error: `date:${field.key}` };
      value = s;
    } else if (field.type === "select" || field.type === "radio") {
      const s = sanitizeText(String(rawValue), 120);
      if (!field.options?.includes(s)) return { ok: false, error: `option:${field.key}` };
      value = s;
    } else {
      value = sanitizeText(String(rawValue), field.max_length ?? (field.type === "textarea" ? MAX_TEXT : 500));
      if (field.required && !value) return { ok: false, error: `required:${field.key}` };
    }

    ordered.push({ key: field.key, label: field.label, type: field.type, value });
    map[field.key] = value;
  }

  return { ok: true, answers: { ordered, map } };
}

export function validateSignature(
  requireSignature: boolean,
  signerName: unknown,
  signatureData: unknown,
): { ok: true; signerName: string | null; signatureData: string | null } | { ok: false; error: string } {
  if (!requireSignature) return { ok: true, signerName: null, signatureData: null };
  const name = sanitizeText(String(signerName ?? ""), 120);
  if (name.length < 2) return { ok: false, error: "signer_name_required" };
  const sig = typeof signatureData === "string" ? signatureData.trim() : "";
  if (!sig) return { ok: false, error: "signature_required" };
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig)) return { ok: false, error: "signature_invalid" };
  if (sig.length > MAX_SIGNATURE_CHARS) return { ok: false, error: "signature_too_large" };
  return { ok: true, signerName: name, signatureData: sig };
}

export interface CanonicalInput {
  templateId: string;
  templateVersionId: string;
  version: number;
  title: string;
  kind: string;
  requireSignature: boolean;
  answers: ValidatedAnswers;
  signerName: string | null;
}

/** Deterministic snapshot: fixed key order, fixed field order, no timestamps. */
export function buildCanonicalSnapshot(input: CanonicalInput): Record<string, unknown> {
  return {
    schema_version: 1,
    template_id: input.templateId,
    template_version_id: input.templateVersionId,
    version: input.version,
    title: input.title,
    kind: input.kind,
    require_signature: input.requireSignature,
    signer_name: input.signerName,
    fields: input.answers.ordered.map((a) => ({
      key: a.key,
      label: a.label,
      type: a.type,
      value: a.value,
    })),
  };
}

/** Stable JSON: object keys sorted, arrays preserved, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export async function documentHash(snapshot: Record<string, unknown>): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(snapshot));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Public form token: 256 bits of CSPRNG entropy, url-safe. */
export function generateFormToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Only the hash is stored server-side; the raw token lives in the link. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
