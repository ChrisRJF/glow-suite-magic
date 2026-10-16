import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const src = readFileSync("supabase/functions/create-auto-revenue-payment/index.ts", "utf8");
const pb = readFileSync("supabase/functions/public-booking/index.ts", "utf8");
describe("deployed non-charging safety wiring", () => {
  it("auto-revenue authorizes before any payment work", () => {
    expect(src.indexOf("authorizeAutoRevenue(")).toBeGreaterThan(0);
    expect(src.indexOf("authorizeAutoRevenue(")).toBeLessThan(src.indexOf("payments\")"));
  });
  it("auto-revenue denies Mollie for real salons", () => expect(src).toMatch(/customerPaymentProvider\(provider\) === "deny"/));
  it("public-booking stores unpaid deposit as payment_pending and blocks Mollie for real salons", () => {
    expect(pb).toMatch(/paymentStatus === "payment_pending" \? "payment_pending"/);
    expect(pb).toMatch(/provider === "mollie" && !isDemo/);
  });
});
