// INACTIVE (round 8D). Adapter: guard.isStopped(salonId, e164) -> Gateway STOP data.
// Not imported by any entrypoint. No network/env/DB here: everything is injected.
//
// Chain: verified salon link (public.gateway_tenant_links, proposed) -> external Gateway tenant id
//        -> contact refs under EVERY key version (contactRef.checkStopBeforeSend)
//        -> public.whatsapp_is_opted_out(_salon, _refs) (proposed RPC, scoped to this salon).
// Returns true (stopped) / false (verified not stopped). Every other outcome THROWS, which the
// guard maps to 503 "consent_lookup_failed": no claim, no provider call.
// customer_message_preferences.whatsapp_opt_out is checked separately by the guard (always).

import { checkStopBeforeSend, computeCurrentContactRef, parseKeyRing, type KeyRing } from "./contactRef.ts";

/** Existing STOP keywords. Whole message only (trimmed, case-insensitive, trailing "." / "!" allowed);
 *  "stop met die actie" is NOT a STOP. */
export const STOP_WORDS = ["STOP", "STOPPEN", "AFMELDEN", "UITSCHRIJVEN", "UNSUBSCRIBE"] as const;
export function isStopKeyword(text: unknown): boolean {
  if (typeof text !== "string" || text.length > 64) return false;
  const t = text.trim().replace(/[.!]+$/, "").toUpperCase();
  return (STOP_WORDS as readonly string[]).includes(t);
}

/** Gateway-side step (offline reference): verified inbound text + sender -> opt_out_signal data.
 *  Only the keyed contact_ref leaves this function; the phone number is never returned or stored.
 *  null = not a STOP, or sender not normalisable (no signal, nothing stored). */
export async function buildOptOutData(ring: KeyRing, gatewayTenantId: string, sender: unknown, text: unknown)
  : Promise<{ channel: "whatsapp"; contact_ref: string } | null> {
  if (!isStopKeyword(text)) return null;
  const ref = await computeCurrentContactRef(ring, gatewayTenantId, sender);
  return ref ? { channel: "whatsapp", contact_ref: ref } : null;
}

export interface GatewayLinkRow { tenant_id: unknown; salon_id: unknown; enabled: unknown; allowed_action_types: unknown }
export interface RpcResult { data: unknown; error: { code?: string; message?: string } | null }
export interface StopAdapterDeps {
  /** select tenant_id,salon_id,enabled,allowed_action_types from gateway_tenant_links where salon_id=$1. null = no row; throw = down. */
  linkForSalon(salonId: string): Promise<GatewayLinkRow | null>;
  /** Raw secret value {"current":"1","keys":{"1":"<Base64>"}}; null = not configured. */
  contactRefConfig: string | null | undefined;
  /** rpc("whatsapp_is_opted_out", {_salon, _refs}) */
  rpc(fn: "whatsapp_is_opted_out", args: { _salon: string; _refs: string[] }): Promise<RpcResult>;
}

export class StopCheckBlocked extends Error {
  constructor(public readonly reason: string) { super(reason); this.name = "StopCheckBlocked"; }
}

// "schema not applied" codes: undefined_table, undefined_function, PostgREST function not found.
const SCHEMA_MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function makeGatewayIsStopped(d: StopAdapterDeps) {
  return async function isStopped(salonId: string, e164: string): Promise<boolean> {
    if (typeof salonId !== "string" || !UUID.test(salonId)) throw new StopCheckBlocked("invalid_salon");
    const ring = parseKeyRing(d.contactRefConfig);
    if (ring.ok === false) throw new StopCheckBlocked(`contact_ref_config_${ring.reason}`);

    let link: GatewayLinkRow | null;
    try { link = await d.linkForSalon(salonId); } catch { throw new StopCheckBlocked("tenant_link_lookup_failed"); }
    if (!link) throw new StopCheckBlocked("tenant_not_mapped");
    if (link.salon_id !== salonId) throw new StopCheckBlocked("tenant_link_mismatch");
    if (link.enabled !== true) throw new StopCheckBlocked("tenant_link_disabled");
    if (!Array.isArray(link.allowed_action_types) || !link.allowed_action_types.includes("opt_out_signal"))
      throw new StopCheckBlocked("tenant_link_without_stop");
    const gw = link.tenant_id;
    if (typeof gw !== "string" || !gw) throw new StopCheckBlocked("tenant_not_mapped");
    // The internal salon id is never a valid Gateway tenant id.
    if (gw.toLowerCase() === salonId.toLowerCase()) throw new StopCheckBlocked("tenant_id_is_salon_id");

    let failure: string | null = null;
    const r = await checkStopBeforeSend(ring.ring.keys, gw, e164, async (refs) => {
      let res: RpcResult;
      try { res = await d.rpc("whatsapp_is_opted_out", { _salon: salonId, _refs: refs }); }
      catch { failure = "stop_db_unreachable"; throw new Error("x"); }
      if (!res || typeof res !== "object") { failure = "stop_db_unexpected"; throw new Error("x"); }
      if (res.error) {
        failure = SCHEMA_MISSING.has(String(res.error.code ?? "")) ? "stop_schema_missing" : "stop_db_error";
        throw new Error("x");
      }
      if (res.data === true || res.data === false) return res.data;
      failure = "stop_db_unexpected"; throw new Error("x");
    });
    if (r.blocked === false) return false;
    if (r.reason === "stopped") return true;
    throw new StopCheckBlocked(failure ?? r.reason);
  };
}
