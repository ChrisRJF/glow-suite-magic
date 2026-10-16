// STAGED, default-off. One orchestrator for LIVE salon deposits (public-booking, auto-revenue,
// payment links) and LIVE ISV payment webhooks 1796/1797/1798. All DB/network via injected deps so
// the running functions only need a thin call once activation is approved. Every doubt = no charge,
// no paid status. Master switch LIVE_ISV_CHECKOUT_ENABLED (isvLiveCheckout.ts) stays false.
import { getLiveIsvToken, type EnvGet } from "./isvLiveConfig.ts";
import type { Fetch, MerchantRow, AuthoritativeAccount } from "./isvOnboardingSafety.ts";
import { deriveCapabilities, prepareLiveIsvOrder, LIVE_ISV_CHECKOUT_ENABLED } from "./isvLiveCheckout.ts";
import { evaluateLiveConfirmation, fetchLiveIsvTransaction, type LivePayment } from "./isvLiveConfirm.ts";
import { feeSnapshot, refundIsvFeeCents, type FeeConfig } from "./isvFee.ts";

export type DepositSource = "public_booking" | "auto_revenue" | "payment_link";

export interface DepositDeps {
  env: EnvGet; fetch: Fetch; enabled?: boolean;
  /** Server-resolved tenant only (slug lookup / authorizeAutoRevenue), never the request body. */
  loadMerchant(tenantId: string): Promise<MerchantRow | null | "error">;
  retrieve(row: MerchantRow): Promise<AuthoritativeAccount | null>;
  feeConfig(tenantId: string): Promise<FeeConfig | null>;
  /** Existing pending live payment for this idempotency key (same tenant), or null. */
  findExisting(tenantId: string, key: string): Promise<{ id: string; checkout_url: string | null; status: string } | null | "error">;
  /** Inserts pending payment + fee snapshot atomically; "duplicate" on unique-key race. */
  insertPending(payment: Record<string, unknown>, snapshot: Record<string, unknown>): Promise<"ok" | "duplicate" | "error">;
  attachOrder(paymentId: string, orderCode: string, checkoutUrl: string): Promise<boolean>;
  markFailed(paymentId: string, reason: string): Promise<void>;
  newId(): string;
}

export type DepositResult =
  | { ok: true; paymentId: string; checkoutUrl: string; reused: boolean }
  | { ok: false; reason: string; charged: false };

const CHECKOUT_HOST = "https://www.vivapayments.com/web/checkout?ref=";

export async function startLiveDeposit(i: {
  tenantId: string; source: DepositSource; idempotencyKey: string; amountCents: number; description: string;
  successUrl: string; failureUrl: string; refs: Record<string, string | null>;
}, d: DepositDeps): Promise<DepositResult> {
  const no = (reason: string): DepositResult => ({ ok: false, reason, charged: false });
  if (!(d.enabled ?? LIVE_ISV_CHECKOUT_ENABLED)) return no("live_isv_checkout_disabled");
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(i.idempotencyKey)) return no("invalid_idempotency_key");
  const prior = await d.findExisting(i.tenantId, i.idempotencyKey);
  if (prior === "error") return no("lookup_failed");
  if (prior) return prior.status === "pending" && prior.checkout_url
    ? { ok: true, paymentId: prior.id, checkoutUrl: prior.checkout_url, reused: true } : no(`existing_${prior.status}`);
  const row = await d.loadMerchant(i.tenantId);
  if (row === "error" || !row) return no("merchant_unclear");
  const caps = deriveCapabilities(row, await d.retrieve(row));
  const cfg = await d.feeConfig(i.tenantId);
  if (!cfg) return no("fee_config_unavailable");
  const o = prepareLiveIsvOrder({ tenantId: i.tenantId, row, caps, amountCents: i.amountCents, description: i.description,
    successUrl: i.successUrl, failureUrl: i.failureUrl, enabled: true, feeConfig: cfg });
  if (!o.ok || !o.fee) return no(o.ok ? "fee_missing" : o.error);
  const id = d.newId();
  const ins = await d.insertPending({
    id, user_id: i.tenantId, status: "pending", is_demo: false, provider: "viva", amount: i.amountCents / 100, currency: "EUR",
    metadata: { route: "viva_isv_live", source: i.source, idempotency_key: i.idempotencyKey, viva_merchant_id: o.merchantId, ...i.refs },
  }, feeSnapshot(id, i.tenantId, true, o.fee));
  if (ins === "duplicate") return no("duplicate_in_flight");
  if (ins !== "ok") return no("payment_write_failed");
  const token = await getLiveIsvToken(d.env, d.fetch);
  if (!token) { await d.markFailed(id, "token_unavailable"); return no("token_unavailable"); }
  let orderCode = "";
  try {
    const r = await d.fetch(o.url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(o.body) });
    const j: any = r.ok ? await r.json().catch(() => null) : null;
    orderCode = j?.orderCode != null ? String(j.orderCode) : "";
  } catch { /* unclear outcome below */ }
  if (!/^\d{10,20}$/.test(orderCode)) { await d.markFailed(id, "order_unclear"); return no("order_unclear"); }
  const url = CHECKOUT_HOST + orderCode;
  if (!(await d.attachOrder(id, orderCode, url))) return no("attach_failed");
  return { ok: true, paymentId: id, checkoutUrl: url, reused: false };
}

// ---- Webhooks: 1796 Transaction Payment Created, 1797 Transaction Reversal Created, 1798 Transaction Failed
export const LIVE_PAYMENT_EVENTS = new Set([1796, 1797, 1798]);

export interface WebhookDeps {
  env: EnvGet; fetch: Fetch; enabled?: boolean;
  findByOrderCode(orderCode: string): Promise<(LivePayment & { refunded_cents?: number; refunded_fee_cents?: number }) | null | "error">;
  loadVerifiedMerchant(tenantId: string): Promise<{ user_id: string; viva_merchant_id: string; verified: boolean } | null>;
  loadSnapshot(paymentId: string): Promise<{ amount_cents: number; fee_cents: number } | null>;
  /** Conditional pending->paid (WHERE status='pending'); false if already changed. */
  markPaid(paymentId: string, record: Record<string, unknown>): Promise<boolean>;
  markFailedIfPending(paymentId: string, reason: string): Promise<void>;
  /** Idempotent on transactionId. */
  recordRefund(paymentId: string, txId: string, refundCents: number, feeCents: number): Promise<"ok" | "duplicate" | "error">;
}

export type WebhookResult = { status: 200 | 503; note: string };

export async function handleLivePaymentEvent(eventTypeId: number, data: any, d: WebhookDeps, nowIso: string): Promise<WebhookResult> {
  if (!(d.enabled ?? LIVE_ISV_CHECKOUT_ENABLED)) return { status: 200, note: "live_disabled" };
  if (!LIVE_PAYMENT_EVENTS.has(eventTypeId)) return { status: 200, note: "ignored_event" };
  const orderCode = String(data?.OrderCode ?? ""), txId = String(data?.TransactionId ?? "");
  const eventMerchant = data?.MerchantId ? String(data.MerchantId) : null;
  const p = await d.findByOrderCode(orderCode);
  if (p === "error") return { status: 503, note: "lookup_failed" };
  if (!p || (p.metadata as any)?.route !== "viva_isv_live") return { status: 200, note: "not_live_isv_order" };
  const merchant = await d.loadVerifiedMerchant(p.user_id);
  const stored = String((p.metadata as any)?.viva_merchant_id ?? "");
  if (!merchant || merchant.user_id !== p.user_id || merchant.viva_merchant_id !== stored) return { status: 200, note: "merchant_hold" };
  const tx = await fetchLiveIsvTransaction(d.env, stored, txId, d.fetch);

  if (eventTypeId === 1798) {
    if (tx && tx.statusId !== "F" && tx.orderCode === orderCode) await d.markFailedIfPending(p.id, `viva_${tx.statusId || "failed"}`);
    return { status: 200, note: tx ? "failed_recorded" : "failed_unverified" };
  }
  if (eventTypeId === 1796) {
    const r = evaluateLiveConfirmation({ payment: p, merchant, eventMerchantId: eventMerchant, transactionId: txId, tx }, nowIso);
    if (!r.ok) return r.reason === "viva_unverified" ? { status: 503, note: "retry_unverified" } : { status: 200, note: `hold_${r.reason}` };
    return { status: 200, note: (await d.markPaid(p.id, r.record)) ? "paid" : "already_processed" };
  }
  // 1797 refund: Viva must confirm the reversal for this merchant/order; fee returned proportionally.
  if (p.status !== "paid") return { status: 200, note: "refund_on_unpaid_hold" };
  if (!tx) return { status: 503, note: "retry_unverified" };
  if (tx.statusId !== "F" || tx.orderCode !== orderCode || tx.currencyCode !== "978" || (tx.merchantId !== null && tx.merchantId !== stored)) return { status: 200, note: "refund_mismatch_hold" };
  const snap = await d.loadSnapshot(p.id);
  if (!snap) return { status: 200, note: "snapshot_missing_hold" };
  let fee: number;
  try {
    fee = refundIsvFeeCents({ amountCents: snap.amount_cents, feeCents: snap.fee_cents, refundedAmountCents: p.refunded_cents ?? 0, refundedFeeCents: p.refunded_fee_cents ?? 0 }, tx.amountCents);
  } catch { return { status: 200, note: "refund_exceeds_hold" }; }
  const w = await d.recordRefund(p.id, txId, tx.amountCents, fee);
  return w === "error" ? { status: 503, note: "refund_write_failed" } : { status: 200, note: w === "ok" ? "refund_recorded" : "refund_duplicate" };
}
