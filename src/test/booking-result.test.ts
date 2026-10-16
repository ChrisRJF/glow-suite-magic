import { describe, it, expect } from "vitest";
import { bookingOutcome } from "@/lib/bookingResult";
import nl from "@/i18n/locales/nl.json";

describe("booking outcome", () => {
  it("saved booking with unavailable deposit is calm info, not error or paid", () => {
    expect(bookingOutcome({ paymentInitError: "x", appointment: { id: "a" } })).toBe("saved_unpaid");
  });
  it("no booking saved is a failure", () => {
    expect(bookingOutcome({ paymentInitError: "x" })).toBe("failed");
    expect(bookingOutcome(null)).toBe("failed");
  });
  it("normal booking is success", () => expect(bookingOutcome({ confirmation: {} })).toBe("success"));
  it("unpaid message says nothing was charged and never claims payment", () => {
    const m = (nl as any).booking.payment.savedUnpaid as string;
    expect(m).toMatch(/niets afgeschreven/);
    expect(m).not.toMatch(/betaald|bevestigd|Mollie/i);
  });
});
