// Maps the create_booking server response to what the customer sees.
// A saved booking whose deposit could not start is NOT an error and NOT paid: it is "saved_unpaid".
export type BookingOutcome = "success" | "saved_unpaid" | "failed";

export function bookingOutcome(result: { paymentInitError?: string | null; appointment?: unknown; confirmation?: unknown } | null | undefined): BookingOutcome {
  if (!result) return "failed";
  const saved = Boolean(result.appointment || result.confirmation);
  if (!result.paymentInitError) return saved ? "success" : "failed";
  return saved ? "saved_unpaid" : "failed";
}
