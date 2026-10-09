// INACTIVE. Fail-closed WhatsApp consent. Replaces `whatsapp_opt_in !== false`
// (which treats null/unknown as consent) once approved.

export type MessagePurpose = "transactional" | "marketing";

export interface ConsentInput {
  purpose: MessagePurpose;
  customer: {
    phone?: string | null;
    whatsapp_opt_in?: boolean | null;
    archived_at?: string | null;
    pseudonymized_at?: string | null;
    communication_blocked_at?: string | null;
  } | null | undefined;
  /** Salon-scoped STOP / opt-out record (e.g. customer preference whatsapp_opt_out). */
  stoppedInTenant: boolean;
}

export type ConsentDecision = { allowed: true } | { allowed: false; reason: string };

export function evaluateWhatsAppConsent(i: ConsentInput): ConsentDecision {
  const c = i.customer;
  if (!c) return { allowed: false, reason: "customer_not_found" };
  if (c.archived_at || c.pseudonymized_at || c.communication_blocked_at) {
    return { allowed: false, reason: "customer_communication_blocked" };
  }
  if (!c.phone) return { allowed: false, reason: "no_phone" };
  // STOP always wins, for every purpose.
  if (i.stoppedInTenant) return { allowed: false, reason: "customer_stopped" };
  if (c.whatsapp_opt_in === false) return { allowed: false, reason: "customer_opted_out" };
  // Only an explicit true counts as consent. Unknown (null) fails closed.
  if (c.whatsapp_opt_in !== true) return { allowed: false, reason: "consent_unknown" };
  return { allowed: true };
}

/** Recognised STOP keywords (exact message, case-insensitive, trimmed). */
const STOP_WORDS = new Set(["stop", "stoppen", "afmelden", "uitschrijven", "unsubscribe"]);
export function isStopKeyword(text: unknown): boolean {
  return typeof text === "string" && STOP_WORDS.has(text.trim().toLowerCase());
}
