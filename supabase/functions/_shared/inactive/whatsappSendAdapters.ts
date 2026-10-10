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
  LOVABLE_API_KEY?: string | null;
  TWILIO_API_KEY?: string | null;
  /** Approved central sender, e.g. whatsapp:+31...; the Twilio sandbox number is refused. */
  WA_FROM_NUMBER?: string | null;
}

export const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio/Messages.json";
const SANDBOX_FROM = "whatsapp:+14155238886";
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
export function buildDeps(db: Db, env: AdapterEnv, io: { fetch: typeof fetch; now(): number; timeoutMs?: number }): BuiltDeps | null {
  const claimKey = key32(env.WA_CLAIM_HMAC_KEY);
  const from = env.WA_FROM_NUMBER;
  if (!claimKey || !env.WA_CONTACT_REF_KEYS || !env.LOVABLE_API_KEY || !env.TWILIO_API_KEY) return null;
  if (typeof from !== "string" || !/^whatsapp:\+[1-9]\d{7,14}$/.test(from) || from === SANDBOX_FROM) return null;

  // wa_claim_send also stores customer_id + kind, which the guard's claim(tenant,key,fp) does not
  // pass. Captured from this request's own customer()/fingerprint calls. buildDeps() MUST be
  // called once per request (never shared across concurrent requests).
  const ctx: { customer: string | null; kind: string | null } = { customer: null, kind: null };

  const isStopped = makeGatewayIsStopped({
    contactRefConfig: env.WA_CONTACT_REF_KEYS,
    async linkForSalon(salonId) {
      return (await one(db, "gateway_tenant_links", "tenant_id,salon_id,enabled,allowed_action_types", { salon_id: salonId })) as GatewayLinkRow | null;
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
        "id,user_id,phone,whatsapp_opt_in,marketing_consent,archived_at,pseudonymized_at,communication_blocked_at", { id })) as CustomerRow | null;
      ctx.customer = c?.id ?? null;
      return c;
    },
    async appointment(id) {
      return (await one(db, "appointments", "id,user_id,customer_id", { id })) as { user_id: string; customer_id: string | null } | null;
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
      console.log("wa-send", { tenant: log.tenant_id, kind: log.kind, purpose: log.purpose, to: log.to_masked,
        content_fp: log.content_fp.slice(0, 12), status: state, code: log.provider_code, finalized: r.data === true && !r.error });
      if (r.error || r.data !== true) throw new Error("finalize_failed");
    },
    async transport(toE164, body) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), io.timeoutMs ?? 10_000);
      let res: Response;
      try {
        res = await io.fetch(TWILIO_GATEWAY, {
          method: "POST", signal: ctl.signal,
          headers: { Authorization: `Bearer ${env.LOVABLE_API_KEY}`, "X-Connection-Api-Key": env.TWILIO_API_KEY!,
            "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ To: `whatsapp:${toE164}`, From: from, Body: body }),
        });
      } finally { clearTimeout(t); }
      // 5xx / unreadable 2xx: provider may have sent it -> throw = outcome unknown, never resent.
      if (res.status >= 500) throw new Error("provider_unknown");
      let j: Record<string, unknown> = {};
      try { j = await res.json(); } catch { if (res.ok) throw new Error("provider_unknown"); }
      if (res.ok) {
        if (typeof j.sid !== "string") throw new Error("provider_unknown");
        return { accepted: true, sid: j.sid };
      }
      return { accepted: false, code: typeof j.code === "number" ? j.code : res.status };
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
          return r ? ({ type, ...r } as EventRow) : null;
        }
        case "rebook_action": {
          const r = await one(db, "rebook_actions", "id,user_id,customer_id,appointment_id,reversed_at", { id });
          return r ? ({ type, ...r } as EventRow) : null;
        }
        case "form_request": {
          const r = await one(db, "form_requests", "id,user_id,customer_id,appointment_id,status,completed_at,expires_at", { id });
          if (!r) return null;
          const { expires_at, ...rest } = r;
          return { type, ...rest, expires_at_ms: typeof expires_at === "string" ? Date.parse(expires_at) : NaN } as EventRow;
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
