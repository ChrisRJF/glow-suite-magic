// STAGED, default-off. One orchestrator for LIVE salon deposits (public-booking, auto-revenue,
// payment links) and LIVE ISV payment webhooks 1796/1797/1798. All DB/network via injected deps so
// the running functions only need a thin call once activation is approved. Every doubt = no charge,
// no paid status. Master switch LIVE_ISV_CHECKOUT_ENABLED (isvLiveCheckout.ts) stays false.
import { getLiveIsvToken, retrieveLiveAccount, type EnvGet } from "./isvLiveConfig.ts";
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
  /** Holds uncertain orders permanently; never releases the idempotency reservation. */
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
  findByTransactionId?(transactionId: string): Promise<LivePayment | null | "error">;
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
  const p = orderCode ? await d.findByOrderCode(orderCode) : data?.ParentId && d.findByTransactionId ? await d.findByTransactionId(String(data.ParentId)) : null;
  if (p === "error") return { status: 503, note: "lookup_failed" };
  if (!p || (p.metadata as any)?.route !== "viva_isv_live") return { status: 200, note: "not_live_isv_order" };
  const merchant = await d.loadVerifiedMerchant(p.user_id);
  const stored = String((p.metadata as any)?.viva_merchant_id ?? "");
  if (!merchant || merchant.user_id !== p.user_id || merchant.viva_merchant_id !== stored) return { status: 200, note: "merchant_hold" };
  if (eventMerchant && eventMerchant !== stored) return { status: 200, note: "merchant_hold" };
  const tx = await fetchLiveIsvTransaction(d.env, stored, txId, d.fetch);
  const boundOrder = String(p.metadata?.viva_order_code ?? "");

  if (eventTypeId === 1798) {
    if (!tx) return { status: 503, note: "retry_unverified" };
    if (!["R", "X", "E"].includes(tx.statusId) || tx.orderCode !== boundOrder || tx.currencyCode !== "978" || tx.merchantId !== stored || tx.amountCents !== Math.round(p.amount * 100)) return { status: 200, note: "failed_mismatch_hold" };
    await d.markFailedIfPending(p.id, `viva_${tx.statusId}`);
    return { status: 200, note: "failed_recorded" };
  }
  if (eventTypeId === 1796) {
    const r = evaluateLiveConfirmation({ payment: p, merchant, eventMerchantId: eventMerchant, transactionId: txId, tx }, nowIso);
    if (!r.ok) return r.reason === "viva_unverified" ? { status: 503, note: "retry_unverified" } : { status: 200, note: `hold_${r.reason}` };
    return { status: 200, note: (await d.markPaid(p.id, r.record)) ? "paid" : "already_processed" };
  }
  // 1797 refund: Viva must confirm the reversal for this merchant/order; fee returned proportionally.
  if (p.status !== "paid") return { status: 200, note: "refund_on_unpaid_hold" };
  if (!tx) return { status: 503, note: "retry_unverified" };
  if (tx.statusId !== "F" || tx.orderCode !== boundOrder || tx.currencyCode !== "978" || tx.merchantId !== stored || tx.amountCents >= 0 || !tx.parentId || tx.parentId !== p.metadata?.viva_transaction_id) return { status: 200, note: "refund_mismatch_hold" };
  const snap = await d.loadSnapshot(p.id);
  if (!snap) return { status: 200, note: "snapshot_missing_hold" };
  let fee: number;
  try {
    fee = refundIsvFeeCents({ amountCents: snap.amount_cents, feeCents: snap.fee_cents, refundedAmountCents: p.refunded_cents ?? 0, refundedFeeCents: p.refunded_fee_cents ?? 0 }, -tx.amountCents);
  } catch { return { status: 200, note: "refund_exceeds_hold" }; }
  const w = await d.recordRefund(p.id, txId, -tx.amountCents, fee);
  return w === "error" ? { status: 503, note: "refund_write_failed" } : { status: 200, note: w === "ok" ? "refund_recorded" : "refund_duplicate" };
}

// Concrete adapters shared by the existing entrypoints. Secret and database access stay server-side.
export function makeDepositDeps(admin: any, env: EnvGet, fetchFn: Fetch = fetch): DepositDeps {
  return {
    env, fetch: fetchFn, newId: () => crypto.randomUUID(),
    async loadMerchant(tid) {
      const r = await admin.from("glowpay_connected_merchants").select("*").eq("user_id", tid).eq("is_demo", false).limit(2);
      return r.error || r.data?.length !== 1 ? "error" : r.data[0];
    },
    async retrieve(row) { return row.viva_account_id ? retrieveLiveAccount(row.viva_account_id, env, fetchFn) : null; },
    async feeConfig(tid) { const r = await admin.rpc("isv_fee_config", { _tenant: tid }); return r.error ? null : r.data; },
    async findExisting(tid, key) {
      const r = await admin.from("isv_payment_orders").select("payment_id,state,checkout_url").eq("tenant_id", tid).eq("request_key", key).maybeSingle();
      return r.error ? "error" : r.data ? { id: r.data.payment_id, status: r.data.state === "ready" ? "pending" : r.data.state, checkout_url: r.data.checkout_url } : null;
    },
    async insertPending(payment, snapshot) { const r = await admin.rpc("isv_payment_reserve", { _payment: payment, _snapshot: snapshot }); return r.error ? "error" : r.data; },
    async attachOrder(pid, code, url) { const r = await admin.rpc("isv_payment_attach", { _payment_id: pid, _order_code: code, _checkout_url: url }); return !r.error && r.data === true; },
    async markFailed(pid, reason) {
      const r = await admin.from("isv_payment_orders").update({ state: "held", failure_reason: reason }).eq("payment_id", pid).eq("state", "dispatching");
      if (r.error) throw r.error;
    },
  };
}

export function makeWebhookDeps(admin: any, env: EnvGet, fetchFn: Fetch = fetch): WebhookDeps {
  const find = async (column: string, value: string) => {
    const r = await admin.from("isv_payment_orders").select("*").eq(column, value).maybeSingle();
    if (r.error) return "error" as const;
    if (!r.data) return null;
    const [p, s] = await Promise.all([
      admin.from("payments").select("*").eq("id", r.data.payment_id).eq("user_id", r.data.tenant_id).eq("is_demo", false).maybeSingle(),
      admin.from("isv_fee_snapshots").select("*").eq("payment_id", r.data.payment_id).maybeSingle(),
    ]);
    if (p.error || s.error || !p.data || !s.data) return "error" as const;
    // Bind to the private order record, never salon-editable JSON or status.
    return { ...p.data, status: r.data.state === "paid" ? "paid" : "pending", amount: s.data.amount_cents / 100,
      metadata: { ...p.data.metadata, route: "viva_isv_live", viva_merchant_id: r.data.merchant_id, viva_order_code: r.data.order_code, viva_transaction_id: r.data.transaction_id },
      refunded_cents: s.data.refunded_amount_cents, refunded_fee_cents: s.data.refunded_fee_cents };
  };
  return {
    env, fetch: fetchFn,
    findByOrderCode: (v) => find("order_code", v), findByTransactionId: (v) => find("transaction_id", v),
    async loadVerifiedMerchant(tid) {
      const d = makeDepositDeps(admin, env, fetchFn); const row = await d.loadMerchant(tid);
      if (!row || row === "error" || !row.viva_merchant_id) return null;
      const acc = await d.retrieve(row);
      return { user_id: tid, viva_merchant_id: row.viva_merchant_id, verified: deriveCapabilities(row, acc).online_payments_enabled };
    },
    async loadSnapshot(pid) { const r = await admin.from("isv_fee_snapshots").select("amount_cents,fee_cents").eq("payment_id", pid).maybeSingle(); return r.error ? null : r.data; },
    async markPaid(pid, evidence) {
      const r = await admin.rpc("isv_payment_record", { _payment_id: pid, _transaction_id: evidence.transaction_id, _kind: "payment", _amount_cents: evidence.amount_cents });
      if (r.error || r.data === "error") throw new Error("live_payment_record_failed");
      return r.data === "ok";
    },
    async markFailedIfPending(pid, reason) {
      const r = await admin.from("isv_payment_orders").update({ state: "failed", failure_reason: reason }).eq("payment_id", pid).eq("state", "ready");
      if (r.error) throw r.error;
    },
    async recordRefund(pid, tx, cents) { const r = await admin.rpc("isv_payment_record", { _payment_id: pid, _transaction_id: tx, _kind: "refund", _amount_cents: cents }); return r.error ? "error" : r.data; },
  };
}
