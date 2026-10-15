import { describe, it, expect } from "vitest";
import { glowpayPaymentStatus, bookingStatus } from "@/lib/glowpayOnboardingStatus";

const base = { viva_account_id: "acc-fake", viva_merchant_id: "m-fake", onboarding_status: "active", kyc_status: "verified", online_payments_enabled: true, is_demo: false };

describe("GlowPay wizard status", () => {
  it("no row or no account = not started", () => {
    expect(glowpayPaymentStatus(null)).toBe("not_started");
    expect(glowpayPaymentStatus({ ...base, viva_account_id: null })).toBe("not_started");
  });
  it("invited / connected without verified KYC = pending", () => {
    expect(glowpayPaymentStatus({ ...base, onboarding_status: "invited", kyc_status: null })).toBe("pending");
    expect(glowpayPaymentStatus({ ...base, kyc_status: "pending" })).toBe("pending");
  });
  it("rejected = action needed", () => {
    expect(glowpayPaymentStatus({ ...base, onboarding_status: "rejected" })).toBe("action_needed");
    expect(glowpayPaymentStatus({ ...base, kyc_status: "rejected" })).toBe("action_needed");
  });
  it("active only with verified KYC, merchant ID and payments on, never demo", () => {
    expect(glowpayPaymentStatus(base)).toBe("active");
    expect(glowpayPaymentStatus({ ...base, viva_merchant_id: null })).toBe("pending");
    expect(glowpayPaymentStatus({ ...base, online_payments_enabled: false })).toBe("pending");
    expect(glowpayPaymentStatus({ ...base, is_demo: true })).toBe("pending");
  });
  it("booking status from saved slug", () => {
    expect(bookingStatus("studio-nova")).toBe("active");
    expect(bookingStatus(null)).toBe("not_set_up");
    expect(bookingStatus("  ")).toBe("not_set_up");
  });
});
