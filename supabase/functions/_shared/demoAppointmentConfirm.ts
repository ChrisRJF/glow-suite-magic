// Demo-only confirmation for appointment checkout payments.
// Records a provider-verified Viva DEMO approval as metadata.demo_provider_confirmation.
// Never changes payments.status, amount, paid_at, ledger, appointments, stock or customer spend.

export type DemoConfirmInput = {
  payment: { id: string; user_id: string; is_demo: boolean | null; provider: string | null; amount: number | string | null; metadata: Record<string, unknown> | null };
  tenantIsDemo: boolean;
  transactionId: string | null;
  eventMerchantTrns: string | null;
  eventTerminalId: string | null;
  // Values returned by Viva's own API for transactionId (null when lookup failed)
  verified: { statusId: string | null; amountCents: number | null } | null;
};

export type DemoConfirmResult =
  | { ok: true; record: Record<string, unknown> }
  | { ok: false; reason: string };

export function evaluateDemoConfirmation(i: DemoConfirmInput, nowIso: string): DemoConfirmResult {
  const meta = (i.payment.metadata ?? {}) as Record<string, unknown>;
  if (i.payment.is_demo !== true) return { ok: false, reason: "not_demo_payment" };
  if (i.payment.provider !== "viva") return { ok: false, reason: "not_viva" };
  if (meta.checkout !== "appointment_checkout") return { ok: false, reason: "not_appointment_checkout" };
  if (meta.environment !== "demo") return { ok: false, reason: "not_demo_environment" };
  if (!i.tenantIsDemo) return { ok: false, reason: "tenant_not_demo" };
  if (!i.transactionId) return { ok: false, reason: "no_transaction_id" };
  const existing = meta.demo_provider_confirmation as Record<string, unknown> | undefined;
  if (existing) return { ok: false, reason: existing.transaction_id === i.transactionId ? "already_confirmed" : "already_confirmed_other_tx" };
  if (i.eventMerchantTrns !== i.payment.id) return { ok: false, reason: "reference_mismatch" };
  if (meta.terminal_id && i.eventTerminalId !== String(meta.terminal_id)) return { ok: false, reason: "terminal_mismatch" };
  if (!i.verified) return { ok: false, reason: "provider_unverified" };
  if (i.verified.statusId !== "F") return { ok: false, reason: "provider_not_approved" };
  const expected = Math.round(Number(i.payment.amount ?? 0) * 100);
  if (!Number.isInteger(i.verified.amountCents) || expected <= 0 || i.verified.amountCents !== expected) return { ok: false, reason: "amount_mismatch" };
  return {
    ok: true,
    record: { transaction_id: i.transactionId, amount_cents: expected, status_id: "F", environment: "demo", confirmed_at: nowIso, source: "viva_api_verified" },
  };
}
