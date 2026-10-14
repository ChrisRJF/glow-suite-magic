// Confirmation of payments created by the secured ISV demo route (viva-isv-demo-order).
// Pure decision + injected fetch, so it is testable without network or secrets.
// Demo only: never touches ledger, revenue, margin or confirmed commission.
import { ISV_DEMO_AMOUNT_CENTS, ISV_DEMO_KEY } from "./isvDemoGuard.ts";

export type IsvDemoPayment = {
  id: string; status: string; is_demo: boolean; payment_type?: string | null;
  viva_merchant_id?: string | null; metadata?: Record<string, unknown> | null;
};

/** True only for rows written by our own ISV demo route. */
export function isIsvDemoPayment(p: IsvDemoPayment): boolean {
  return p.is_demo === true && p.payment_type === "isv_demo" && (p.metadata as any)?.isv_demo_key === ISV_DEMO_KEY;
}

export type VivaTx = { statusId: string; amountCents: number; currencyCode: string; orderCode: string; merchantId: string | null };

export type ConfirmInput = {
  payment: IsvDemoPayment;
  hasExpectedCommission: boolean;
  eventMerchantId: string | null; // null when not from a webhook (one-time recovery)
  transactionId: string;
  tx: VivaTx | null; // fetched directly from Viva with ISV credentials
};

export type ConfirmResult = { ok: true; record: Record<string, unknown> } | { ok: false; reason: string };

export function evaluateIsvDemoConfirmation(i: ConfirmInput, nowIso: string): ConfirmResult {
  const p = i.payment;
  if (!isIsvDemoPayment(p)) return { ok: false, reason: "not_isv_demo" };
  if (p.status !== "pending") return { ok: false, reason: `status_${p.status}` };
  if (!i.hasExpectedCommission) return { ok: false, reason: "expected_commission_missing" };
  const stored = (p.viva_merchant_id ?? "").trim();
  if (!stored) return { ok: false, reason: "merchant_missing" };
  if (i.eventMerchantId !== null && i.eventMerchantId !== stored) return { ok: false, reason: "event_merchant_mismatch" };
  const storedOrder = String((p.metadata as any)?.viva_order_code ?? "");
  if (!storedOrder) return { ok: false, reason: "order_code_missing" };
  const tx = i.tx;
  if (!tx) return { ok: false, reason: "viva_unverified" };
  if (tx.statusId !== "F") return { ok: false, reason: `viva_status_${tx.statusId || "unknown"}` };
  if (tx.amountCents !== ISV_DEMO_AMOUNT_CENTS) return { ok: false, reason: "amount_mismatch" };
  if (tx.currencyCode !== "978") return { ok: false, reason: "currency_mismatch" };
  if (tx.orderCode !== storedOrder) return { ok: false, reason: "order_code_mismatch" };
  if (tx.merchantId !== null && tx.merchantId !== stored) return { ok: false, reason: "viva_merchant_mismatch" };
  return {
    ok: true,
    record: {
      transaction_id: i.transactionId, status_id: tx.statusId, amount_cents: tx.amountCents,
      currency_code: tx.currencyCode, order_code: tx.orderCode,
      merchant_check: tx.merchantId !== null ? "viva_field" : "merchant_scoped_lookup",
      verified_via: "viva_isv_api", verified_at: nowIso,
    },
  };
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Retrieve one transaction from Viva demo with ISV OAuth only (no merchant fallback). Null = unverifiable. */
export async function fetchIsvDemoTransaction(
  env: Record<string, string | undefined>, merchantId: string, transactionId: string, f: FetchFn = fetch,
): Promise<VivaTx | null> {
  const id = (env.VIVA_ISV_CLIENT_ID ?? "").trim();
  const secret = (env.VIVA_ISV_CLIENT_SECRET ?? "").trim();
  if (!id || !secret || (env.VIVA_ENVIRONMENT ?? "demo").toLowerCase() !== "demo") return null;
  try {
    const tok = await f("https://demo-accounts.vivapayments.com/connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${id}:${secret}`) },
      body: "grant_type=client_credentials",
    });
    const tj: any = await tok.json().catch(() => ({}));
    if (!tok.ok || !tj.access_token) { console.warn("[isv-demo-confirm] token", tok.status); return null; }
    const res = await f(`https://demo-api.vivapayments.com/checkout/v2/isv/transactions/${encodeURIComponent(transactionId)}?merchantId=${encodeURIComponent(merchantId)}`, {
      headers: { Authorization: `Bearer ${tj.access_token}`, Accept: "application/json" },
    });
    const d: any = await res.json().catch(() => ({}));
    console.log("[isv-demo-confirm] lookup", JSON.stringify({ http_status: res.status }));
    if (!res.ok) return null;
    const amount = Number(d.amount ?? d.Amount);
    if (!Number.isFinite(amount)) return null;
    const mid = d.merchantId ?? d.MerchantId;
    return {
      statusId: String(d.statusId ?? d.StatusId ?? ""),
      amountCents: Math.round(amount * 100),
      currencyCode: String(d.currencyCode ?? d.CurrencyCode ?? ""),
      orderCode: String(d.orderCode ?? d.OrderCode ?? ""),
      merchantId: mid ? String(mid) : null,
    };
  } catch (e) {
    console.warn("[isv-demo-confirm] lookup error", String((e as Error)?.message || "error"));
    return null;
  }
}

/** Shared apply step: verify, then pending -> paid only once. Returns a reason code. */
export async function confirmIsvDemoPayment(
  supabase: any, env: Record<string, string | undefined>, payment: IsvDemoPayment,
  transactionId: string, eventMerchantId: string | null, f: FetchFn = fetch,
): Promise<{ result: "confirmed" | "already" | "rejected" | "unavailable"; reason: string }> {
  const { data: comm, error: cErr } = await supabase.from("platform_commission_entries")
    .select("id").eq("payment_id", payment.id).eq("kind", "expected").limit(1);
  if (cErr) return { result: "unavailable", reason: "commission_lookup_failed" };
  const pre = evaluateIsvDemoConfirmation({ payment, hasExpectedCommission: !!comm?.length, eventMerchantId, transactionId, tx: { statusId: "F", amountCents: ISV_DEMO_AMOUNT_CENTS, currencyCode: "978", orderCode: String((payment.metadata as any)?.viva_order_code ?? ""), merchantId: null } }, "");
  if (!pre.ok) return { result: pre.reason.startsWith("status_paid") ? "already" : "rejected", reason: pre.reason };
  const tx = await fetchIsvDemoTransaction(env, String(payment.viva_merchant_id), transactionId, f);
  if (!tx) return { result: "unavailable", reason: "viva_unverified" };
  const nowIso = new Date().toISOString();
  const res = evaluateIsvDemoConfirmation({ payment, hasExpectedCommission: true, eventMerchantId, transactionId, tx }, nowIso);
  if (!res.ok) return { result: "rejected", reason: res.reason };
  const { data: upd, error } = await supabase.from("payments")
    .update({ status: "paid", paid_at: nowIso, last_status_sync_at: nowIso, metadata: { ...(payment.metadata || {}), isv_demo_provider_confirmation: res.record } })
    .eq("id", payment.id).eq("is_demo", true).eq("status", "pending").select("id");
  if (error) return { result: "unavailable", reason: "update_failed" };
  return upd?.length ? { result: "confirmed", reason: "isv_demo_confirmed" } : { result: "already", reason: "isv_demo_already_processed" };
}
