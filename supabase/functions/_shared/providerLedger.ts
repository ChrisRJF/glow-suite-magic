// Shared provider-evidence step, used ONLY for payments marked metadata.checkout = "appointment_checkout".
// Older payments keep their existing flow and are never recalculated from the ledger.
// Rules: only provider-verified data reaches the ledger; appointment totals come only from the ledger;
// a failed/cancelled attempt never lowers an already proven deposit.

export interface Evidence {
  tenantId: string; paymentId: string; provider: "viva" | "mollie";
  transactionId: string | null | undefined; kind: "payment" | "refund";
  amountCents: number; currency: string; source: "poll" | "webhook";
}
export type RecordResult = "recorded" | "duplicate" | "conflict" | "amount_mismatch" | "currency_mismatch" | "tenant_mismatch" | "no_payment" | "invalid";

export interface LedgerDeps {
  record: (e: Evidence) => Promise<RecordResult>;          // rpc record_provider_payment
  totals: (tenantId: string, appointmentId: string) => Promise<{ paidCents: number; refundedCents: number }>; // rpc appointment_ledger_totals
  priceCents: (tenantId: string, appointmentId: string) => Promise<number | null>;
  updateAppointment: (tenantId: string, appointmentId: string, patch: { amount_paid: number; payment_status: string }) => Promise<void>;
}

/** Appointment status derived only from proven money. */
export function derivePaymentStatus(priceCents: number | null, paidCents: number, refundedCents: number): string {
  // Values match those already used in appointments.payment_status (betaald / unpaid) plus explicit states.
  if (refundedCents > 0) return refundedCents >= paidCents ? "terugbetaald" : "gedeeltelijk_terugbetaald";
  if (paidCents <= 0) return "unpaid";
  if (priceCents != null && paidCents >= priceCents) return "betaald";
  return "aanbetaald";
}

/** Call after the provider API confirmed a paid/refunded transaction. Never throws into the webhook. */
export async function applyEvidence(e: Evidence, appointmentId: string | null, d: LedgerDeps): Promise<RecordResult | "error"> {
  if (!e.transactionId || !Number.isInteger(e.amountCents) || e.amountCents <= 0) return "invalid";
  let r: RecordResult;
  try { r = await d.record(e); } catch { return "error"; }
  if ((r === "recorded" || r === "duplicate") && appointmentId) await syncAppointment(e.tenantId, appointmentId, d).catch(() => {});
  return r;
}

/** Call for failed/cancelled/expired attempts instead of writing payment_status = 'unpaid'. */
export async function syncAppointment(tenantId: string, appointmentId: string, d: LedgerDeps): Promise<void> {
  const t = await d.totals(tenantId, appointmentId);
  const price = await d.priceCents(tenantId, appointmentId);
  await d.updateAppointment(tenantId, appointmentId, {
    amount_paid: (t.paidCents - t.refundedCents) / 100,
    payment_status: derivePaymentStatus(price, t.paidCents, t.refundedCents),
  });
}
