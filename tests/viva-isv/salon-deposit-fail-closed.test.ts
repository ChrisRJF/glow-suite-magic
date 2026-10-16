import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(`supabase/functions/${f}/index.ts`, "utf8");

describe("salon customer deposits never use platform Viva credentials", () => {
  for (const f of ["public-booking", "create-auto-revenue-payment"]) {
    it(`${f} has no platform Viva order call`, () => {
      const src = read(f);
      expect(src).not.toMatch(/createVivaOrder|isVivaConfigured|vivaCheckoutUrl/);
      expect(src).toMatch(/Fail-closed \(security\)/);
    });
  }
  it("auto-revenue ignores the request's demo flag", () => {
    expect(read("create-auto-revenue-payment")).not.toMatch(/bodyIsDemo\s*===/);
  });
  it("public-booking keeps unpaid deposits pending, never paid", () => {
    const src = read("public-booking");
    const block = src.slice(src.indexOf("Fail-closed (security)"), src.indexOf("Fail-closed (security)") + 500);
    expect(block).toMatch(/paymentStatus = "payment_pending"/);
    expect(block).not.toMatch(/"paid"/);
  });
  it("SaaS subscription checkout still uses platform Viva", () => {
    expect(read("saas-checkout-public-viva")).toMatch(/createVivaOrder|checkout\/v2\/orders/);
  });
});
