// ============================================================================
// PREPARED, NOT ACTIVE. Viva ISV finance layer (registration, webhook decisions,
// tenant/platform separation, reporting). Not imported by any entrypoint.
// Pure functions only: no env, no network, no database. Amounts in cents.
// Design: docs/prepared-patches/viva-isv-finance/README.md
// ============================================================================
import { onlineIsvFeeCents, terminalIsvFeeCents } from "./vivaIsvPrepared.ts";

export type Channel = "online" | "terminal";
export type CommissionStatus = "expected" | "confirmed" | "reversed" | "unconfirmed" | "not_owed";

/** Expected ISV fee for a channel. Tap has no active route and is deliberately not a channel. */
export function expectedIsvFeeCents(channel: Channel, amountCents: number): number {
  return channel === "online" ? onlineIsvFeeCents(amountCents) : terminalIsvFeeCents(amountCents);
}

// --- Phase 2: payment row prepared BEFORE the Viva order ---------------------

export interface MerchantRow { user_id: string; viva_merchant_id: string | null; viva_source_code: string | null; onboarding_status: string | null; is_demo: boolean }

/**
 * Builds the payments insert for an ISV order. Tenant comes from the server-resolved
 * session tenant, merchant from glowpay_connected_merchants for THAT tenant. The client
 * may only supply amount (server re-prices) and an idempotency key.
 */
export function buildIsvPaymentRow(input: {
  sessionTenantId: string; merchant: MerchantRow | null; channel: Channel;
  amountCents: number; idempotencyKey: string; appointmentId?: string | null;
}): { ok: true; row: Record<string, unknown> } | { ok: false; error: string } {
  const m = input.merchant;
  if (!m) return { ok: false, error: "merchant_not_connected" };
  if (m.user_id !== input.sessionTenantId) return { ok: false, error: "merchant_tenant_mismatch" };
  if (!["connected", "active"].includes(String(m.onboarding_status ?? "").toLowerCase())) return { ok: false, error: "merchant_not_active" };
  if (!m.viva_merchant_id || !m.viva_source_code) return { ok: false, error: "merchant_config_missing" };
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { ok: false, error: "invalid_amount_cents" };
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.idempotencyKey)) return { ok: false, error: "invalid_idempotency_key" };
  return {
    ok: true,
    row: {
      user_id: input.sessionTenantId, appointment_id: input.appointmentId ?? null,
      amount: input.amountCents / 100, currency: "EUR", status: "pending", provider: "viva", method: "viva",
      is_demo: m.is_demo, viva_merchant_id: m.viva_merchant_id, viva_source_code: m.viva_source_code,
      checkout_reference: null, // filled only after Viva returns an orderCode
      metadata: {
        payment_kind: "isv", isv_channel: input.channel, idempotency_key: input.idempotencyKey,
        total_amount_cents: input.amountCents,
        isv_fee_expected_cents: expectedIsvFeeCents(input.channel, input.amountCents),
        isv_fee_status: "expected",
      },
    },
  };
}

/** Outcome of the Viva order call. Failure never yields paid; it marks the row failed. */
export function applyOrderResult(row: Record<string, unknown>, result: { ok: true; orderCode: string } | { ok: false; httpStatus: number | null }) {
  if (result.ok) return { ...row, checkout_reference: result.orderCode };
  return { ...row, status: "failed", metadata: { ...(row.metadata as object), order_error_status: result.httpStatus } };
}

/** Idempotency: an existing row with the same key is reused, never a second order. */
export function findReusable(rows: Array<{ id: string; status: string; metadata: Record<string, unknown> }>, key: string) {
  return rows.find((r) => r.metadata?.idempotency_key === key && r.status !== "failed") ?? null;
}

// --- Phase 3: webhook decision (applies only to payment_kind = isv) ---------

export interface WebhookInput {
  eventTypeId: number; statusId: string | null; orderCode: string | null; merchantId: string | null;
  verifiedByVivaApi: boolean; verifiedAmountCents: number | null;
  /** Viva-reported ISV fee in cents, only from a verified Viva source. Undefined = not reported. */
  vivaReportedIsvFeeCents?: number | null;
  alreadyProcessedEventId: boolean;
}
export interface PaymentState {
  id: string; user_id: string; viva_merchant_id: string | null; status: string; amountCents: number;
  refundedCents: number; metadata: Record<string, unknown>;
}
export type Decision =
  | { action: "ignore"; reason: string }
  | { action: "log_only"; reason: string }
  | { action: "update"; patch: { status?: string; refundedCents?: number; metadata: Record<string, unknown> } };

export function decideIsvWebhook(ev: WebhookInput, payment: PaymentState | null): Decision {
  if (ev.alreadyProcessedEventId) return { action: "ignore", reason: "duplicate_event" };
  if (ev.eventTypeId === 1799) return { action: "log_only", reason: "log_only_price_calculated" };
  if (!payment) return { action: "log_only", reason: "payment_not_found" }; // never guess a tenant
  if (payment.metadata.payment_kind !== "isv") return { action: "ignore", reason: "not_isv_payment" };
  if (!ev.merchantId || ev.merchantId !== payment.viva_merchant_id) return { action: "log_only", reason: "merchant_mismatch" };
  if (!ev.verifiedByVivaApi) return { action: "log_only", reason: "unverified" };
  const meta = { ...payment.metadata };

  if (ev.eventTypeId === 1796) {
    if (ev.statusId !== "F") return { action: "log_only", reason: "not_final" };
    if (ev.verifiedAmountCents !== payment.amountCents) return { action: "log_only", reason: "amount_mismatch" };
    if (payment.status === "paid") return { action: "ignore", reason: "already_paid" };
    // ISV fee replaces legacy margin; never add 0.30 on top. Expected stays expected.
    if (typeof meta.platform_fee_cents !== "number") meta.platform_fee_cents = meta.isv_fee_expected_cents;
    meta.legacy_margin_applied = false;
    if (typeof ev.vivaReportedIsvFeeCents === "number") { meta.isv_fee_confirmed_cents = ev.vivaReportedIsvFeeCents; meta.isv_fee_status = "confirmed"; }
    else meta.isv_fee_status = "unconfirmed";
    return { action: "update", patch: { status: "paid", metadata: meta } };
  }
  if (ev.eventTypeId === 1797 || ev.eventTypeId === 1798) {
    if (payment.status !== "paid" && payment.status !== "partially_refunded") return { action: "log_only", reason: "refund_before_paid" };
    const amt = ev.verifiedAmountCents ?? 0;
    if (amt <= 0) return { action: "log_only", reason: "invalid_refund_amount" };
    const refunded = Math.min(payment.amountCents, payment.refundedCents + amt);
    if (refunded === payment.refundedCents) return { action: "ignore", reason: "nothing_to_refund" };
    // Commission reversal is recorded only when Viva reports it; otherwise it stays open.
    if (typeof ev.vivaReportedIsvFeeCents === "number") meta.isv_fee_reversed_cents = ev.vivaReportedIsvFeeCents;
    else meta.isv_fee_reversal_status = "unconfirmed";
    return { action: "update", patch: { status: refunded >= payment.amountCents ? "refunded" : "partially_refunded", refundedCents: refunded, metadata: meta } };
  }
  return { action: "log_only", reason: "unknown_event" };
}

// --- Phase 5: tenant view strips every platform field -----------------------

const PLATFORM_KEYS = ["platform_fee_cents", "glowpay_margin_cents", "isv_fee_expected_cents", "isv_fee_confirmed_cents",
  "isv_fee_reversed_cents", "isv_fee_status", "isv_fee_reversal_status", "legacy_margin_applied", "reseller_id", "provider_fee_cents"];

export function toSalonPaymentView(p: PaymentState, requesterTenantId: string) {
  if (p.user_id !== requesterTenantId) return null;
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p.metadata)) if (!PLATFORM_KEYS.includes(k)) metadata[k] = v;
  return { id: p.id, status: p.status, amountCents: p.amountCents, refundedCents: p.refundedCents, netCents: p.amountCents - p.refundedCents, metadata };
}

export interface PlatformActor { userId: string; isPlatformOwner: boolean; aal: string | null; salonRoles: string[] }
/** Platform owner = explicit server-side grant AND MFA (aal2). Salon roles never count. */
export function canReadPlatformFinance(a: PlatformActor | null): boolean {
  return !!a && a.isPlatformOwner === true && a.aal === "aal2";
}

// --- Phase 6: reporting without double counting ----------------------------

export interface LedgerRow { payment_id: string; tenant_id: string; kind: "payment" | "refund"; amount_cents: number; method: string; day: string }
export interface Totals {
  grossCents: number; refundCents: number; netCents: number; successCount: number;
  isvExpectedCents: number; isvConfirmedCents: number; isvReversedCents: number;
  isvUnconfirmedCount: number; earnedCents: number | null; earnedStatus: "confirmed" | "partially_unconfirmed";
}

/** Money comes only from payment_ledger (deduped by payment_id+kind); commission only from payments.metadata. */
export function aggregate(ledger: LedgerRow[], payments: PaymentState[], filter?: { tenantId?: string; period?: string }): Totals {
  const seen = new Set<string>();
  let gross = 0, refund = 0; const successIds = new Set<string>();
  for (const r of ledger) {
    if (filter?.tenantId && r.tenant_id !== filter.tenantId) continue;
    if (filter?.period && !r.day.startsWith(filter.period)) continue;
    const key = `${r.payment_id}:${r.kind}:${r.amount_cents}:${r.day}`;
    if (seen.has(key)) continue; seen.add(key);
    if (r.kind === "payment") { gross += r.amount_cents; successIds.add(r.payment_id); } else refund += r.amount_cents;
  }
  let exp = 0, conf = 0, rev = 0, unconf = 0;
  for (const p of payments) {
    if (!successIds.has(p.id) || p.metadata.payment_kind !== "isv") continue;
    exp += Number(p.metadata.isv_fee_expected_cents ?? 0);
    if (typeof p.metadata.isv_fee_confirmed_cents === "number") conf += p.metadata.isv_fee_confirmed_cents; else unconf++;
    if (typeof p.metadata.isv_fee_reversed_cents === "number") rev += p.metadata.isv_fee_reversed_cents;
  }
  return {
    grossCents: gross, refundCents: refund, netCents: gross - refund, successCount: successIds.size,
    isvExpectedCents: exp, isvConfirmedCents: conf, isvReversedCents: rev, isvUnconfirmedCount: unconf,
    earnedCents: conf - rev, earnedStatus: unconf > 0 ? "partially_unconfirmed" : "confirmed",
  };
}
