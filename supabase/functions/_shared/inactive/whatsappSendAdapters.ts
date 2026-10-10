// INACTIVE (Send Security 1.0). Real data adapters for the future whatsapp-send. Not imported by
// any active entrypoint. All I/O goes through the injected `Db` + `fetch`, so tests run offline.
//
// Existing tables/columns only (src/integrations/supabase/types.ts, read-only):
//   user_roles(user_id, role) · user_access(owner_user_id, member_user_id, role, status)
//   customers(id, user_id, phone, whatsapp_opt_in, marketing_consent, archived_at, pseudonymized_at, communication_blocked_at)
//   appointments(id, user_id, customer_id, status, appointment_date, start_time)
//   customer_message_preferences(user_id, customer_id, whatsapp_opt_out)
//   settings(user_id, is_demo, demo_mode, created_at) · whatsapp_settings(user_id, enabled)
//   automation_runs / rebook_actions / form_requests (see eventVerifier.ts)
// PROPOSED, NOT INSTALLED (docs/proposed-migrations/):
//   tenant_feature_flags.whatsapp_sending_paused (2026-10-10_whatsapp_sending_paused_flag.sql)
//   wa_claim_send / wa_finalize_send / wa_remember_nonce (2026-10-10_whatsapp_send_claims_nonces.sql)
//   gateway_tenant_links / whatsapp_is_opted_out (2026-10-09_whatsapp_gateway_receiver.sql)
//   whatsapp_meta_connections (2026-10-10_whatsapp_meta_connections.sql): per-salon WABA + phone id
// While those are missing every send fails closed (503), which is the intended first state.

import type { ClaimResult, ClaimState, CustomerRow, Deps, MinimalLog, Role, ServiceCaller, ServiceKeyConfig, ServiceVerifyDeps } from "./whatsappSendGuard.ts";
import { validateKeyConfig } from "./whatsappSendGuard.ts";
import { makeGatewayIsStopped, type GatewayLinkRow } from "./gatewayStopAdapter.ts";
import { decodeBase64Strict } from "./contactRef.ts";
import { localToEpochMs, type EventRow, type EventType } from "./eventVerifier.ts";

export interface DbError { code?: string; message?: string }
export interface Db {
  select(table: string, cols: string, eq: Record<string, string>, opts?: { limit?: number; orderDesc?: string }):
    Promise<{ data: Record<string, unknown>[] | null; error: DbError | null }>;
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: DbError | null }>;
}

export interface AdapterEnv {
  /** Base64, >= 32 raw bytes. Keyed fingerprints + claim keys. */
  WA_CLAIM_HMAC_KEY?: string | null;
  /** {"current":"1","keys":{"1":"<Base64>"}} (contactRef.ts format) */
  WA_CONTACT_REF_KEYS?: string | null;
  /** {"<caller>":{"current":"1","keys":{"1":"<Base64>"}}} one entry per internal caller */
  WA_SEND_SERVICE_KEYS?: string | null;
  /** Meta app id this deployment is authorised as. A connection made via another app = refused. */
  WA_META_APP_ID?: string | null;
  /** {"<kind>":{"name","language","category":"UTILITY|MARKETING","params":n}}. Must exist AND be APPROVED at Meta. */
  WA_META_TEMPLATES?: string | null;
}

// Transport: official Meta WhatsApp Cloud API (Graph), called directly with the salon's OWN token.
//   POST {GRAPH}/{version}/{phone_number_id}/messages      (Authorization: Bearer <token>)
//   GET  {GRAPH}/{version}/{waba_id}/message_templates
// No global Lovable connector key anywhere in this route. Version pinned; re-check against
// Meta's changelog before activation (developers.facebook.com/docs/graph-api/changelog).
export const META_GRAPH = "https://graph.facebook.com";
export const META_GRAPH_VERSION = "v25.0";
const META_ID = /^\d{5,20}$/;
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
const LANG = /^[a-z]{2,3}(_[A-Z]{2})?$/;
export interface TemplateCfg { name: string; language: string; category: "UTILITY" | "MARKETING"; params: number }

/** Server-side record of one salon's Meta connection. Never contains the token itself. */
export interface MetaConnection {
  tenant_id: string;
  waba_id: string;
  phone_number_id: string;
  status: "active" | "pending" | "revoked" | "expired" | "disabled";
  app_id: string;
  credential_ref: string;
  /** e.g. ["template_utility","template_marketing"] */
  capabilities: string[];
  expires_at_ms?: number | null;
}
export interface MetaResolvers {
  /** Looks up by verified tenant only. 0 rows -> null; error/ambiguous -> throw. */
  connectionForTenant(tenantId: string): Promise<MetaConnection | null>;
  /** Resolves credential_ref -> access token for exactly this connection. Unknown -> null. */
  credential(ref: string, conn: MetaConnection): Promise<string | null>;
}
type Resolved = { ok: true; conn: MetaConnection; token: string } | { ok: false; status: number; reason: string };

/** Fail-closed validation of a resolved connection for this tenant + purpose. */
export async function resolveMetaSender(r: MetaResolvers, tenantId: string, expectedAppId: string, category: "UTILITY" | "MARKETING", nowMs: number): Promise<Resolved> {
  let c: MetaConnection | null;
  try { c = await r.connectionForTenant(tenantId); } catch { return { ok: false, status: 503, reason: "connection_lookup_failed" }; }
  if (!c) return { ok: false, status: 503, reason: "sender_not_configured" };
  if (c.tenant_id !== tenantId) return { ok: false, status: 403, reason: "sender_tenant_mismatch" };
  if (typeof c.waba_id !== "string" || !META_ID.test(c.waba_id) || typeof c.phone_number_id !== "string" || !META_ID.test(c.phone_number_id) ||
    typeof c.credential_ref !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(c.credential_ref) || !Array.isArray(c.capabilities))
    return { ok: false, status: 503, reason: "connection_invalid" };
  if (c.status !== "active") return { ok: false, status: 503, reason: "connection_inactive" };
  if (c.expires_at_ms != null && !(Number.isFinite(c.expires_at_ms) && c.expires_at_ms > nowMs)) return { ok: false, status: 503, reason: "connection_inactive" };
  if (c.app_id !== expectedAppId) return { ok: false, status: 403, reason: "connection_app_mismatch" };
  if (!c.capabilities.includes(`template_${category.toLowerCase()}`)) return { ok: false, status: 422, reason: "capability_not_allowed" };
  let token: string | null;
  try { token = await r.credential(c.credential_ref, c); } catch { return { ok: false, status: 503, reason: "credential_unavailable" }; }
  if (typeof token !== "string" || token.length < 20 || /\s/.test(token)) return { ok: false, status: 503, reason: "credential_unavailable" };
  return { ok: true, conn: c, token };
}
export function parseTemplates(raw: unknown): Record<string, TemplateCfg> | null {
  if (typeof raw !== "string" || !raw) return null;
  let j: unknown; try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const out: Record<string, TemplateCfg> = {};
  for (const [kind, v] of Object.entries(j as Record<string, unknown>)) {
    const t = v as Partial<TemplateCfg> | null;
    if (!t || typeof t.name !== "string" || !TEMPLATE_NAME.test(t.name) || typeof t.language !== "string" || !LANG.test(t.language) ||
      (t.category !== "UTILITY" && t.category !== "MARKETING") || !Number.isInteger(t.params) || t.params! < 0 || t.params! > 10) return null;
    out[kind] = { name: t.name, language: t.language, category: t.category, params: t.params! };
  }
  return out;
}
const placeholders = (text: unknown) => typeof text === "string" ? new Set(text.match(/\{\{\d+\}\}/g) ?? []).size : -1;
const ROLES: Role[] = ["eigenaar", "admin", "manager", "medewerker", "financieel", "receptie"];

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
export async function hmacHex(key: Uint8Array, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}
export async function sha256Hex(msg: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg)));
}

function key32(b64: unknown): Uint8Array | null {
  const k = decodeBase64Strict(b64);
  return k && k.length >= 32 ? k : null;
}

/** Whole config valid or null (deny). */
export function parseServiceKeys(raw: unknown): ServiceKeyConfig | null {
  if (typeof raw !== "string" || !raw) return null;
  let j: unknown; try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const out: Record<string, { current: string; keys: Record<string, Uint8Array> }> = {};
  for (const [caller, v] of Object.entries(j as Record<string, unknown>)) {
    if (!v || typeof v !== "object") return null;
    const { current, keys } = v as { current?: unknown; keys?: unknown };
    if (typeof current !== "string" || !keys || typeof keys !== "object") return null;
    const ks: Record<string, Uint8Array> = {};
    for (const [id, b64] of Object.entries(keys as Record<string, unknown>)) {
      const k = key32(b64); if (!k) return null; ks[id] = k;
    }
    out[caller] = { current, keys: ks };
  }
  return validateKeyConfig(out) ? (out as ServiceKeyConfig) : null;
}

/** 0 rows -> null, 1 row -> row, error or >1 rows -> throw (ambiguous = fail closed). */
async function one(db: Db, table: string, cols: string, eq: Record<string, string>, opts?: { orderDesc?: string }) {
  const r = await db.select(table, cols, eq, { limit: opts?.orderDesc ? 1 : 2, ...opts });
  if (r.error || !Array.isArray(r.data)) throw new Error(`${table}_lookup_failed`);
  if (r.data.length > 1) throw new Error(`${table}_ambiguous`);
  return r.data[0] ?? null;
}

export interface BuiltDeps { deps: Deps; service: ServiceVerifyDeps }

/** null = configuration missing/invalid -> the HTTP layer answers 503 before any read. */
export function buildDeps(db: Db, env: AdapterEnv, io: { fetch: typeof fetch; now(): number; timeoutMs?: number; log?: (e: Record<string, unknown>) => void; meta?: MetaResolvers }): BuiltDeps | null {
  const claimKey = key32(env.WA_CLAIM_HMAC_KEY);
  const appId = env.WA_META_APP_ID;
  if (!claimKey || !env.WA_CONTACT_REF_KEYS || !io.meta) return null;
  if (typeof appId !== "string" || !META_ID.test(appId)) return null;
  const templates = parseTemplates(env.WA_META_TEMPLATES);
  if (!templates) return null;
  const meta = io.meta;
  const graph = `${META_GRAPH}/${META_GRAPH_VERSION}`;
  async function timed(url: string, init: RequestInit): Promise<Response> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), io.timeoutMs ?? 10_000);
    try { return await io.fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
  }

  // wa_claim_send also stores customer_id + kind, which the guard's claim(tenant,key,fp) does not
  // pass. Captured from this request's own customer()/fingerprint calls. buildDeps() MUST be
  // called once per request (never shared across concurrent requests).
  const ctx: { customer: string | null; kind: string | null; sender: { tenant: string; phone: string; token: string } | null } = { customer: null, kind: null, sender: null };

  const isStopped = makeGatewayIsStopped({
    contactRefConfig: env.WA_CONTACT_REF_KEYS,
    async linkForSalon(salonId) {
      return (await one(db, "gateway_tenant_links", "tenant_id,salon_id,enabled,allowed_action_types", { salon_id: salonId })) as unknown as GatewayLinkRow | null;
    },
    async rpc(fn, args) { return db.rpc(fn, args); },
  });

  const deps: Deps = {
    now: io.now,
    // Mirrors public.current_tenant_id(): owner = own tenant, else exactly one active user_access owner.
    async tenantOfUser(userId) {
      const roles = await db.select("user_roles", "role", { user_id: userId }, { limit: 10 });
      if (roles.error || !Array.isArray(roles.data)) throw new Error("user_roles_lookup_failed");
      if (roles.data.some((r) => r.role === "eigenaar")) return userId;
      const acc = await db.select("user_access", "owner_user_id", { member_user_id: userId, status: "active" }, { limit: 10 });
      if (acc.error || !Array.isArray(acc.data)) throw new Error("user_access_lookup_failed");
      const owners = new Set(acc.data.map((r) => r.owner_user_id));
      return owners.size === 1 ? String([...owners][0]) : null;
    },
    async roleInTenant(userId, tenantId) {
      if (userId === tenantId) {
        const roles = await db.select("user_roles", "role", { user_id: userId }, { limit: 10 });
        if (roles.error || !Array.isArray(roles.data)) throw new Error("user_roles_lookup_failed");
        return roles.data.some((r) => r.role === "eigenaar") ? "eigenaar" : null;
      }
      const row = await one(db, "user_access", "role", { member_user_id: userId, owner_user_id: tenantId, status: "active" });
      return row && ROLES.includes(row.role as Role) ? (row.role as Role) : null;
    },
    async customer(id) {
      const c = (await one(db, "customers",
        "id,user_id,phone,whatsapp_opt_in,marketing_consent,archived_at,pseudonymized_at,communication_blocked_at", { id })) as unknown as CustomerRow | null;
      ctx.customer = c?.id ?? null;
      return c;
    },
    async appointment(id) {
      return (await one(db, "appointments", "id,user_id,customer_id", { id })) as unknown as { user_id: string; customer_id: string | null } | null;
    },
    async preferenceWhatsappOptOut(tenantId, customerId) {
      const r = await one(db, "customer_message_preferences", "whatsapp_opt_out", { user_id: tenantId, customer_id: customerId });
      if (!r) return null;
      if (typeof r.whatsapp_opt_out !== "boolean") throw new Error("preference_unexpected");
      return r.whatsapp_opt_out;
    },
    isStopped,
    async whatsappEnabled(tenantId) {
      const r = await one(db, "whatsapp_settings", "enabled", { user_id: tenantId });
      return r?.enabled === true;
    },
    // Missing row or missing column = paused. Only an explicit false releases a salon.
    async sendingPaused(tenantId) {
      const r = await one(db, "tenant_feature_flags", "whatsapp_sending_paused", { tenant_id: tenantId });
      if (!r) return true;
      if (typeof r.whatsapp_sending_paused !== "boolean") throw new Error("flag_unexpected");
      return r.whatsapp_sending_paused;
    },
    async isDemoTenant(tenantId) {
      const r = await one(db, "settings", "is_demo,demo_mode", { user_id: tenantId }, { orderDesc: "created_at" });
      if (!r) throw new Error("settings_missing");
      return r.is_demo === true || r.demo_mode === true;
    },
    async claim(tenantId, key, fingerprint): Promise<ClaimResult> {
      const r = await db.rpc("wa_claim_send", { _tenant: tenantId, _key: key, _fp: fingerprint, _customer: ctx.customer, _kind: ctx.kind });
      const d = r.data as { result?: string; state?: string } | null;
      if (r.error || !d) throw new Error("claim_failed");
      if (d.result === "created") return { created: true };
      if (d.result === "exists" && ["claimed", "sent", "failed", "unknown"].includes(String(d.state)))
        return { created: false, state: d.state as ClaimState, fingerprint };
      // SQL never returns the stored fingerprint; a mismatch is signalled as an impossible value.
      if (d.result === "conflict") return { created: false, state: "claimed", fingerprint: "" };
      throw new Error("claim_unexpected");
    },
    async finalize(tenantId, key, state, log: MinimalLog) {
      const r = await db.rpc("wa_finalize_send", { _tenant: tenantId, _key: key, _state: state, _to_masked: log.to_masked, _provider_code: log.provider_code });
      // Minimal structured log: no message text, no full number, no links/tokens, no raw provider text.
      io.log?.({ ev: "wa-send", tenant: log.tenant_id, kind: log.kind, purpose: log.purpose, to: log.to_masked,
        content_fp: log.content_fp.slice(0, 12), status: state, code: log.provider_code, finalized: r.data === true && !r.error });
      if (r.error || r.data !== true) throw new Error("finalize_failed");
    },
    // Sender + template checks before the claim. No free text: the 24h customer-service window
    // cannot be established server-side (no verified inbound store), so only approved templates go out.
    async prepare({ tenantId, kind, purpose, params }) {
      ctx.sender = null;
      const cfg = templates[kind];
      if (!cfg) return { ok: false, status: 422, reason: "free_text_window_unverified" };
      if (cfg.category !== (purpose === "marketing" ? "MARKETING" : "UTILITY")) return { ok: false, status: 422, reason: "template_category_mismatch" };
      if (params.length !== cfg.params) return { ok: false, status: 422, reason: "template_params_mismatch" };
      const s = await resolveMetaSender(meta, tenantId, appId, cfg.category, io.now());
      if (s.ok !== true) return { ok: false, status: s.status, reason: s.reason };
      const res = await timed(`${graph}/${s.conn.waba_id}/message_templates?name=${encodeURIComponent(cfg.name)}&fields=name,status,language,category,components&limit=25`,
        { method: "GET", headers: { Authorization: `Bearer ${s.token}` } });
      if (!res.ok) throw new Error("template_lookup_failed");
      const j = await res.json() as { data?: Array<Record<string, unknown>> };
      if (!Array.isArray(j?.data)) throw new Error("template_lookup_failed");
      const t = j.data.filter((x) => x.name === cfg.name && x.language === cfg.language);
      if (t.length !== 1) return { ok: false, status: 422, reason: "template_not_found" };
      if (t[0].status !== "APPROVED") return { ok: false, status: 422, reason: "template_not_approved" };
      if (t[0].category !== cfg.category) return { ok: false, status: 422, reason: "template_category_mismatch" };
      const comps = Array.isArray(t[0].components) ? t[0].components as Array<Record<string, unknown>> : [];
      const body = comps.filter((c) => c.type === "BODY");
      if (body.length !== 1 || placeholders(body[0].text) !== cfg.params) return { ok: false, status: 422, reason: "template_format_mismatch" };
      // Headers/buttons with variables are not supported yet: refuse rather than send half-filled.
      if (comps.some((c) => c.type !== "BODY" && c.type !== "FOOTER" && placeholders(c.text) > 0)) return { ok: false, status: 422, reason: "template_format_mismatch" };
      ctx.sender = { tenant: tenantId, phone: s.conn.phone_number_id, token: s.token };
      // Token stays in ctx only; payload carries the phone id so transport can cross-check it.
      return { ok: true, payload: { name: cfg.name, language: cfg.language, params, tenant: tenantId, phone_number_id: s.conn.phone_number_id } };
    },
    async transport(toE164, _body, prepared) {
      const p = prepared as { name?: string; language?: string; params?: string[]; tenant?: string; phone_number_id?: string } | undefined;
      if (!p?.name || !p.language || !Array.isArray(p.params)) return { accepted: false, code: 0 }; // never free text
      const snd = ctx.sender;
      // Sender must be the one resolved for this same tenant in this same request.
      if (!snd || snd.tenant !== p.tenant || snd.phone !== p.phone_number_id) return { accepted: false, code: 0 };
      const res = await timed(`${graph}/${snd.phone}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${snd.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: toE164.replace(/^\+/, ""), type: "template",
          template: { name: p.name, language: { code: p.language },
            components: p.params.length ? [{ type: "body", parameters: p.params.map((text) => ({ type: "text", text })) }] : [] } }),
      });
      // 5xx / unreadable or id-less 2xx: Meta may have sent it -> throw = outcome unknown, never resent.
      if (res.status >= 500) throw new Error("provider_unknown");
      let j: Record<string, unknown> = {};
      try { j = await res.json(); } catch { if (res.ok) throw new Error("provider_unknown"); }
      if (res.ok) {
        const id = (j.messages as Array<{ id?: unknown }> | undefined)?.[0]?.id;
        if (typeof id !== "string" || !/^wamid\.[A-Za-z0-9_=+\/-]{1,256}$/.test(id)) throw new Error("provider_unknown");
        return { accepted: true, sid: id };
      }
      const code = (j.error as { code?: unknown } | undefined)?.code;
      return { accepted: false, code: typeof code === "number" ? code : res.status };
    },
    async hmac(purpose, value) {
      if (purpose === "fp") ctx.kind = value.split("|")[1] ?? null;
      return hmacHex(claimKey, `${purpose}\n${value}`);
    },
    async resolveEvent(type: EventType, id: string): Promise<EventRow | null> {
      switch (type) {
        case "appointment": {
          const r = await one(db, "appointments", "id,user_id,customer_id,status,appointment_date,start_time", { id });
          if (!r) return null;
          const ms = typeof r.appointment_date === "string" && typeof r.start_time === "string"
            ? localToEpochMs(r.appointment_date, r.start_time) : null;
          return { type, id: r.id as string, user_id: r.user_id as string, customer_id: (r.customer_id ?? null) as string | null,
            status: r.status as string, starts_at_ms: ms };
        }
        case "automation_run": {
          const r = await one(db, "automation_runs", "id,user_id,customer_id,appointment_id,status", { id });
          return r ? ({ type, ...r } as unknown as EventRow) : null;
        }
        case "rebook_action": {
          const r = await one(db, "rebook_actions", "id,user_id,customer_id,appointment_id,reversed_at", { id });
          return r ? ({ type, ...r } as unknown as EventRow) : null;
        }
        case "form_request": {
          const r = await one(db, "form_requests", "id,user_id,customer_id,appointment_id,status,completed_at,expires_at", { id });
          if (!r) return null;
          const { expires_at, ...rest } = r;
          return { type, ...rest, expires_at_ms: typeof expires_at === "string" ? Date.parse(expires_at) : NaN } as unknown as EventRow;
        }
      }
      return null;
    },
  };

  const service: ServiceVerifyDeps = {
    keys: parseServiceKeys(env.WA_SEND_SERVICE_KEYS),
    now: io.now, hmacHex, sha256Hex,
    async rememberNonce(caller, nonce, expiresAtMs) {
      const r = await db.rpc("wa_remember_nonce", { _caller: caller, _nonce: nonce, _expires_at: new Date(expiresAtMs).toISOString() });
      if (r.error || typeof r.data !== "boolean") throw new Error("nonce_store_unavailable");
      return r.data;
    },
  };
  return { deps, service };
}

export type { ServiceCaller };
