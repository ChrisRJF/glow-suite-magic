// INACTIVE: checks needed before one controlled ISV demo payment. Not imported by any entrypoint.
import { marginDecisionWithIsv, type MarginDecision } from "./platformMargin.ts";

export const ISV_ONLINE_ORDER_PATH = "/checkout/v2/isv/orders";

/** Refuse anything that is not the official ISV online order path with merchantId in the query. */
export function assertIsvOrderTarget(url: string, query: Record<string, string> | undefined): "ok" | "not_isv_endpoint" | "merchant_id_missing" {
  if (url !== ISV_ONLINE_ORDER_PATH) return "not_isv_endpoint";
  if (!query?.merchantId?.trim()) return "merchant_id_missing";
  return "ok";
}

const AUDIT_KEYS = ["amount", "isvAmount", "sourceCode", "currencyCode", "paymentTimeout", "preauth", "allowRecurring"] as const;

/**
 * Proof of what will be sent, safe to log: only whitelisted money/config keys.
 * Never contains credentials, tokens, customer e-mail, name, phone or free text.
 */
export function auditOrderBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of AUDIT_KEYS) if (k in body) out[k] = body[k];
  out.has_isvAmount = typeof body.isvAmount === "number";
  out.isvAmount_is_integer_cents = Number.isInteger(body.isvAmount);
  return out;
}

/** ISV payments earn the ISV fee only; trustedIsv must come from server-side storage, never metadata. */
export function isvAwareMarginDecision(i: Parameters<typeof marginDecisionWithIsv>[0], trustedIsv: boolean): MarginDecision {
  return marginDecisionWithIsv(i, trustedIsv);
}

/** Confirmed ISV commission needs: verified tx, paid, matching tx id, integer cents within 0..amount. */
export function confirmedIsvCommission(i: {
  txVerified: boolean; paymentStatus: string; paymentTxId: string | null; eventTxId: string | null;
  feeCents: unknown; paymentAmountCents: number;
}): { ok: true; cents: number } | { ok: false; reason: string } {
  if (!i.txVerified) return { ok: false, reason: "unverified" };
  if (i.paymentStatus !== "paid") return { ok: false, reason: "payment_not_paid" };
  if (!i.eventTxId || i.eventTxId !== i.paymentTxId) return { ok: false, reason: "tx_mismatch" };
  if (typeof i.feeCents !== "number" || !Number.isInteger(i.feeCents)) return { ok: false, reason: "fee_missing" };
  if (i.feeCents < 0 || i.feeCents > i.paymentAmountCents) return { ok: false, reason: "fee_out_of_range" };
  return { ok: true, cents: i.feeCents };
}
