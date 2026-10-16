// PREPARED, NOT WIRED. LIVE confirmation of salon ISV orders (from isvLiveCheckout.ts).
// Mirrors the demo flow (../isvDemoConfirm.ts) on the LIVE host with LIVE ISV OAuth only.
// Endpoint: GET {LIVE_ISV_API_HOST}/checkout/v2/isv/transactions/{transactionId}?merchantId={merchantId}
// Status semantics (same as demo): statusId "F" = finished/paid; anything else = not paid.
// Amount in the response is in currency units (EUR), currencyCode "978".
import { getLiveIsvToken, LIVE_ISV_API_HOST, type EnvGet } from "./isvLiveConfig.ts";
import type { Fetch } from "./isvOnboardingSafety.ts";

export type LiveTx = { statusId: string; amountCents: number; currencyCode: string; orderCode: string; merchantId: string | null };

export interface LivePayment {
  id: string; user_id: string; status: string; is_demo: boolean; provider: string | null; amount: number;
  metadata?: Record<string, unknown> | null;
}

export interface LiveConfirmInput {
  payment: LivePayment;
  /** Salon merchant, verified (deriveCapabilities online_payments_enabled) and owned by payment.user_id. */
  merchant: { user_id: string; viva_merchant_id: string; verified: boolean } | null;
  eventMerchantId: string | null;
  transactionId: string;
  tx: LiveTx | null;
}

export type LiveConfirmResult = { ok: true; record: Record<string, unknown> } | { ok: false; reason: string };

export function evaluateLiveConfirmation(i: LiveConfirmInput, nowIso: string): LiveConfirmResult {
  const p = i.payment, m = i.merchant;
  if (p.is_demo !== false || p.provider !== "viva" || (p.metadata as any)?.route !== "viva_isv_live") return { ok: false, reason: "not_live_isv_payment" };
  if (p.status !== "pending") return { ok: false, reason: `status_${p.status}` }; // duplicate webhook / already paid
  if (!m || !m.verified || m.user_id !== p.user_id) return { ok: false, reason: "merchant_not_verified_for_salon" };
  const stored = String((p.metadata as any)?.viva_merchant_id ?? "");
  if (!stored || stored !== m.viva_merchant_id) return { ok: false, reason: "merchant_binding_mismatch" };
  if (i.eventMerchantId !== null && i.eventMerchantId !== stored) return { ok: false, reason: "event_merchant_mismatch" };
  const order = String((p.metadata as any)?.viva_order_code ?? "");
  if (!order) return { ok: false, reason: "order_code_missing" };
  if (!/^[0-9a-fA-F-]{8,64}$/.test(i.transactionId)) return { ok: false, reason: "transaction_id_invalid" };
  const tx = i.tx;
  if (!tx) return { ok: false, reason: "viva_unverified" };
  if (tx.statusId !== "F") return { ok: false, reason: `viva_status_${tx.statusId || "unknown"}` };
  if (tx.orderCode !== order) return { ok: false, reason: "order_code_mismatch" };
  if (tx.amountCents !== Math.round(Number(p.amount) * 100)) return { ok: false, reason: "amount_mismatch" };
  if (tx.currencyCode !== "978") return { ok: false, reason: "currency_mismatch" };
  if (tx.merchantId !== null && tx.merchantId !== stored) return { ok: false, reason: "viva_merchant_mismatch" };
  return { ok: true, record: { transaction_id: i.transactionId, order_code: order, amount_cents: tx.amountCents, merchant_id: stored, verified_via: "viva_isv_live_api", verified_at: nowIso } };
}

/** LIVE ISV lookup scoped to the salon merchant. Null on any doubt. */
export async function fetchLiveIsvTransaction(env: EnvGet, merchantId: string, transactionId: string, f: Fetch): Promise<LiveTx | null> {
  const token = await getLiveIsvToken(env, f);
  if (!token) return null;
  try {
    const r = await f(`${LIVE_ISV_API_HOST}/checkout/v2/isv/transactions/${encodeURIComponent(transactionId)}?merchantId=${encodeURIComponent(merchantId)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!r.ok) return null;
    const d: any = await r.json().catch(() => null);
    const amount = Number(d?.amount ?? d?.Amount);
    if (!d || !Number.isFinite(amount)) return null;
    const mid = d.merchantId ?? d.MerchantId;
    return { statusId: String(d.statusId ?? d.StatusId ?? ""), amountCents: Math.round(amount * 100),
      currencyCode: String(d.currencyCode ?? d.CurrencyCode ?? ""), orderCode: String(d.orderCode ?? d.OrderCode ?? ""), merchantId: mid ? String(mid) : null };
  } catch { return null; }
}
