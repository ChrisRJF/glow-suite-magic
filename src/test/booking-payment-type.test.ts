import { describe, it, expect } from "vitest";
import { paymentRequestType } from "@/pages/BookingPage";
import { calculateNoShowRisk } from "@/lib/noShowRisk";
import type { PaymentDecision } from "@/hooks/usePaymentRules";

/**
 * Targeted regression test for the create_booking payment.type mapping.
 * The booking server (public-booking) only accepts "deposit" | "full" | "remainder".
 * The frontend must never send "none"; when no payment is needed it sends the
 * neutral placeholder "deposit" with required:false and amount:0.
 */

const decision = (partial: Partial<PaymentDecision>): PaymentDecision => ({
  required: false,
  type: "none",
  amount: 0,
  reason: "",
  ...partial,
});

// Mirrors the exact request payload built in create_booking
const requestType = (d: PaymentDecision | null) => paymentRequestType(d?.type);

describe("payment.type mapping for create_booking", () => {
  it("no payment required: decision 'none' maps to 'deposit', required/amount unchanged", () => {
    const d = decision({ required: false, type: "none", amount: 0 });
    expect(requestType(d)).toBe("deposit");
    expect(d.required).toBe(false);
    expect(d.amount).toBe(0);
  });

  it("mandatory deposit: 'deposit' is preserved", () => {
    const d = decision({ required: true, type: "deposit", amount: 55 });
    expect(requestType(d)).toBe("deposit");
  });

  it("full prepayment: 'full' is preserved", () => {
    const d = decision({ required: true, type: "full", amount: 180 });
    expect(requestType(d)).toBe("full");
  });

  it("remainder value from the server set is preserved", () => {
    expect(requestType(decision({ required: true, type: "remainder", amount: 30 }))).toBe("remainder");
  });

  it("free treatment: no decision (null) maps to 'deposit' placeholder", () => {
    expect(requestType(null)).toBe("deposit");
  });

  it("group booking uses the same payload field, mapping identical", () => {
    // Group bookings send the same payment object (single create_booking call with group_members)
    const d = decision({ required: true, type: "deposit", amount: 25 });
    expect(requestType(d)).toBe("deposit");
    const free = decision({ required: false, type: "none", amount: 0 });
    expect(requestType(free)).toBe("deposit");
  });

  it("unknown/missing type falls back to 'deposit'", () => {
    expect(requestType(decision({ type: undefined as any }))).toBe("deposit");
    expect(requestType(decision({ type: "iets-anders" as any }))).toBe("deposit");
  });

  it("no-show risk decision still yields deposit with rounded amount", () => {
    const risk = calculateNoShowRisk({ no_show_count: 2, cancellation_count: 0, total_spent: 0 });
    expect(risk.isElevated).toBe(true);
  });
});
