import { describe, it, expect } from "vitest";
import { isProviderPayment } from "@/lib/providerPayment";

describe("isProviderPayment", () => {
  it("viva is provider", () => expect(isProviderPayment({ provider: "viva" })).toBe(true));
  it("mollie is provider", () => expect(isProviderPayment({ provider: "mollie" })).toBe(true));
  it("kassa order is provider", () => expect(isProviderPayment({ provider: "glowpay", metadata: { kassa_order_id: "x" } })).toBe(true));
  it("manual is not provider", () => expect(isProviderPayment({ provider: "glowpay", metadata: {} })).toBe(false));
  it("missing provider is manual", () => expect(isProviderPayment({ provider: null })).toBe(false));
});
