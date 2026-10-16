// LIVE sale confirmation of salon ISV orders, with LIVE ISV OAuth only.
// Endpoint: GET {LIVE_ISV_API_HOST}/checkout/v2/isv/transactions/{transactionId}?merchantId={merchantId}
// Sale statusId "F" = finished/paid; anything else = not paid.
// Written Viva partner confirmation relayed by Chris on 2026-10-16 proves route and major EUR units.
// This sale contract does NOT establish reversal sign, parent field or reversal status semantics.
import { getLiveIsvToken, LIVE_ISV_API_HOST, type EnvGet } from "./isvLiveConfig.ts";
import type { Fetch } from "./isvOnboardingSafety.ts";

export type LiveTx = { statusId: string; amountCents: number; currencyCode: string; orderCode: string; merchantId: string | null; parentId?: string | null };

export type TransactionContract = { amountUnit: "major" | "minor" };
// Code-only vendor contract, never an env/client override. Charge creation remains separately disabled.
export const LIVE_TRANSACTION_CONTRACT: TransactionContract = { amountUnit: "major" };

export function parseLiveTransaction(d: any, transactionId: string, contract: TransactionContract | null): LiveTx | null {
  if (!contract || !d || typeof d.amount !== "number" || !Number.isFinite(d.amount)) return null;
  const scaled = contract.amountUnit === "major" ? d.amount * 100 : d.amount;
  const amountCents = Math.round(scaled);
  const tolerance = Math.min(0.000001, Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4);
  if (!Number.isSafeInteger(amountCents) || Math.abs(scaled - amountCents) > tolerance) return null;
  if (typeof d.transactionId !== "string" || d.transactionId.toLowerCase() !== transactionId.toLowerCase()) return null;
  if (typeof d.statusId !== "string" || typeof d.merchantId !== "string" || !d.merchantId) return null;
  if (!(typeof d.orderCode === "string" || (typeof d.orderCode === "number" && Number.isSafeInteger(d.orderCode)))) return null;
  if (!(typeof d.currencyCode === "string" || (typeof d.currencyCode === "number" && Number.isSafeInteger(d.currencyCode)))) return null;
  if (d.parentId != null && typeof d.parentId !== "string") return null;
  return { statusId: d.statusId, amountCents, currencyCode: String(d.currencyCode), orderCode: String(d.orderCode), merchantId: d.merchantId, parentId: d.parentId ?? null };
}

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
  if (tx.merchantId !== stored) return { ok: false, reason: "viva_merchant_mismatch" };
  return { ok: true, record: { transaction_id: i.transactionId, order_code: order, amount_cents: tx.amountCents, merchant_id: stored, verified_via: "viva_isv_live_api", verified_at: nowIso } };
}

/** LIVE ISV lookup scoped to the salon merchant. Null on any doubt. */
export async function fetchLiveIsvTransaction(env: EnvGet, merchantId: string, transactionId: string, f: Fetch, contract: TransactionContract | null = LIVE_TRANSACTION_CONTRACT): Promise<LiveTx | null> {
  if (!contract) return null; // No request or amount conversion using an unverified endpoint.
  if (!/^[0-9a-fA-F-]{8,64}$/.test(merchantId) || !/^[0-9a-fA-F-]{8,64}$/.test(transactionId)) return null;
  const token = await getLiveIsvToken(env, f);
  if (!token) return null;
  try {
    const r = await f(`${LIVE_ISV_API_HOST}/checkout/v2/isv/transactions/${encodeURIComponent(transactionId)}?merchantId=${encodeURIComponent(merchantId)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!r.ok) return null;
    const d: any = await r.json().catch(() => null);
    return parseLiveTransaction(d, transactionId, contract);
  } catch { return null; }
}
