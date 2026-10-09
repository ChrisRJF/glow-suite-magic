// INACTIVE. Fail-closed WhatsApp consent. Replaces `whatsapp_opt_in !== false`
// (which treats null/unknown as consent) once approved.

export type MessagePurpose = "transactional" | "marketing";

export interface ConsentInput {
  purpose: MessagePurpose;
  /** Tenant that is sending. */
  tenantId: string;
  customer: {
    user_id?: string | null; // owning tenant
    phone?: string | null;
    whatsapp_opt_in?: boolean | null;
    marketing_opt_in?: boolean | null;
    archived_at?: string | null;
    pseudonymized_at?: string | null;
    communication_blocked_at?: string | null;
  } | null | undefined;
  /** Salon-scoped STOP / opt-out record (whatsapp_opt_outs or preference whatsapp_opt_out). */
  stoppedInTenant: boolean;
}

export type ConsentDecision = { allowed: true } | { allowed: false; reason: string };

export function evaluateWhatsAppConsent(i: ConsentInput): ConsentDecision {
  const c = i.customer;
  if (!c) return { allowed: false, reason: "customer_not_found" };
  // Customer must belong to the sending tenant; unknown owner fails closed.
  if (!c.user_id || c.user_id !== i.tenantId) return { allowed: false, reason: "customer_not_in_tenant" };
  if (c.archived_at || c.pseudonymized_at || c.communication_blocked_at) {
    return { allowed: false, reason: "customer_communication_blocked" };
  }
  if (!c.phone) return { allowed: false, reason: "no_phone" };
  // STOP always wins, for every purpose.
  if (i.stoppedInTenant) return { allowed: false, reason: "customer_stopped" };
  if (c.whatsapp_opt_in === false) return { allowed: false, reason: "customer_opted_out" };
  // Only an explicit true counts as consent. Unknown (null) fails closed.
  if (c.whatsapp_opt_in !== true) return { allowed: false, reason: "consent_unknown" };
  // Marketing needs its own explicit consent on top of WhatsApp consent.
  if (i.purpose === "marketing" && c.marketing_opt_in !== true) {
    return { allowed: false, reason: "marketing_consent_missing" };
  }
  return { allowed: true };
}

/** Recognised STOP keywords (exact message, case-insensitive, trimmed). */
const STOP_WORDS = new Set(["stop", "stoppen", "afmelden", "uitschrijven", "unsubscribe"]);
export function isStopKeyword(text: unknown): boolean {
  return typeof text === "string" && STOP_WORDS.has(text.trim().toLowerCase());
}
