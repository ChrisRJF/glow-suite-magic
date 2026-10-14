// PREPARED, NOT ACTIVE. Never imported by an entrypoint until a separate GO.
// Fix for viva-webhook: event 1799 (Transaction Price Calculated) is a fee
// notification, never a refund and never a payment status change.

export type VivaPaymentStatus =
  | "paid" | "failed" | "expired" | "cancelled" | "pending" | "refunded" | "reversed";

export const PRICE_CALCULATED_EVENT = 1799;

/** Events that may change payments, refunds, ledger or appointments. */
export const FINANCIAL_EVENTS = new Set([1796, 1797, 1798]);

/** Same as the live mapVivaStatus, except 1799 no longer maps to "refunded". */
export function mapVivaStatus(statusId: string, eventTypeId?: number): VivaPaymentStatus {
  if (eventTypeId === PRICE_CALCULATED_EVENT) return "pending";
  if (eventTypeId === 1797) return "reversed";
  if (eventTypeId === 1798) return "refunded";
  if (statusId === "F" || eventTypeId === 1796) return "paid";
  if (statusId === "E") return "failed";
  if (statusId === "X") return "cancelled";
  return "pending";
}

/**
 * True when the handler must stop right after logging the event (ack 200),
 * before any payment, refund, ledger or appointment code runs.
 * Only 1799 is stopped; every other event keeps its existing flow.
 */
export function isLogOnlyEvent(eventTypeId: number | null | undefined): boolean {
  return eventTypeId === PRICE_CALCULATED_EVENT;
}
