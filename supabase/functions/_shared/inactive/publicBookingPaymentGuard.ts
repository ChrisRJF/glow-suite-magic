// PREPARED, NOT WIRED. Fail-closed decision for public-booking online deposits/prepayments.
// Wiring into public-booking (and create-auto-revenue-payment) needs a separate GO + deploy.
//
// Why: the active public-booking path creates Viva orders with PLATFORM credentials
// (VIVA_CLIENT_ID / VIVA_SOURCE_CODE). Funds would land on GlowSuite, not the salon, and no
// KYC/merchant check runs. This guard decides BEFORE any provider call.
//
// Routing rule: a real (non-demo) salon may only be charged through a documented salon-specific
// ISV order (POST /checkout/v2/isv/orders?merchantId=<salon merchant>) with LIVE ISV credentials.
// That LIVE ISV order builder does not exist yet (only the demo builder in vivaIsvPrepared.ts),
// so LIVE_ISV_ORDER_ROUTING_AVAILABLE is false and every real salon gets "no_charge_pending".
import type { GateResult } from "./isvLivePaymentGate.ts";

export const LIVE_ISV_ORDER_ROUTING_AVAILABLE = false as const;

export interface ExistingPayment { id: string; user_id: string; appointment_id: string; status: string; provider: string | null }

export interface DecisionInput {
  /** Tenant resolved server-side from the public slug, never from the request body. */
  tenantId: string | null;
  /** Owner of the appointment that was just inserted by this request. */
  appointmentOwnerId: string | null;
  /** Result of livePaymentGate(tenantId, "link", ...): settings demo flag + KYC + ISV Retrieve. */
  gate: GateResult;
  /** Merchant row the gate approved (salon-owned, is_demo=false). */
  merchant: { user_id: string; viva_merchant_id: string | null; viva_source_code: string | null } | null;
  /** Payments already linked to this appointment (idempotency on retries). */
  existing: ExistingPayment[];
  /** Override only for tests of the future routed path. Production uses the constant. */
  routingAvailable?: boolean;
}

export type Decision =
  | { kind: "demo_simulated" }
  | { kind: "reuse_existing"; paymentId: string }
  | { kind: "isv_order"; merchantId: string; sourceCode: string }
  | { kind: "no_charge_pending"; reason: string };

/** Payment status to store/show for each decision. Unpaid never becomes paid or confirmed. */
export function appointmentPaymentStatus(d: Decision): "paid_simulated" | "pending" | "payment_pending" {
  if (d.kind === "demo_simulated") return "paid_simulated";
  if (d.kind === "isv_order" || d.kind === "reuse_existing") return "pending";
  return "payment_pending";
}

export function decidePublicBookingPayment(i: DecisionInput): Decision {
  if (!i.tenantId || i.appointmentOwnerId !== i.tenantId) return { kind: "no_charge_pending", reason: "tenant_mismatch" };

  const open = i.existing.filter((p) => p.appointment_id && p.user_id === i.tenantId && ["pending", "open", "paid"].includes(p.status));
  if (i.existing.some((p) => p.user_id !== i.tenantId)) return { kind: "no_charge_pending", reason: "cross_tenant_payment" };
  if (open.length) return { kind: "reuse_existing", paymentId: open[0].id };

  if (!i.gate.ok) return { kind: "no_charge_pending", reason: i.gate.reason };
  // Demo: no provider call at all, simulated only. Demo flags are not trusted to mean "real
  // customer absent", so the simulated path must never call Viva or count revenue.
  if (i.gate.demo) return { kind: "demo_simulated" };

  const m = i.merchant;
  if (!m || m.user_id !== i.tenantId) return { kind: "no_charge_pending", reason: "merchant_not_salon" };
  const merchantId = (m.viva_merchant_id ?? "").trim();
  const sourceCode = (m.viva_source_code ?? "").trim();
  if (!merchantId) return { kind: "no_charge_pending", reason: "merchant_missing" };
  if (!sourceCode || sourceCode === "1234") return { kind: "no_charge_pending", reason: "source_code_missing" };
  if (!(i.routingAvailable ?? LIVE_ISV_ORDER_ROUTING_AVAILABLE)) return { kind: "no_charge_pending", reason: "salon_routing_unavailable" };
  return { kind: "isv_order", merchantId, sourceCode };
}

/** Webhook attribution: a payment may only be settled for the salon that owns the event's merchant. */
export function webhookAttributionOk(
  payment: { user_id: string; metadata?: Record<string, unknown> | null },
  eventMerchantId: string | null,
  merchantOwners: Array<{ user_id: string; viva_merchant_id: string }>,
): boolean {
  if (!eventMerchantId) return false;
  const owners = merchantOwners.filter((r) => r.viva_merchant_id === eventMerchantId);
  if (owners.length !== 1) return false;
  if (owners[0].user_id !== payment.user_id) return false;
  const stored = payment.metadata?.viva_merchant_id;
  return stored === eventMerchantId;
}
