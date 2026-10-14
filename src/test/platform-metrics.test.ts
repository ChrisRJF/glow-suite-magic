import { describe, it, expect } from "vitest";
import { sumFinance, formatCents, platformErrorMessage, lastPeriods } from "@/lib/platformMetrics";

const row = (o: Partial<Record<string, number>>) => ({
  tenant_id: "t", gross_cents: 0, refund_cents: 0, net_cents: 0, expected_cents: 0,
  confirmed_cents: 0, reversed_cents: 0, legacy_margin_cents: 0, unconfirmed_count: 0, ...o,
});

describe("platform finance totals", () => {
  it("never counts expected ISV commission as confirmed income", () => {
    const t = sumFinance([row({ expected_cents: 35, unconfirmed_count: 1 })]);
    expect(t.expectedIsvCents).toBe(35);
    expect(t.confirmedIsvCents).toBe(0);
    expect(t.confirmedIncomeCents).toBe(0);
  });
  it("confirmed income is confirmed minus reversed", () => {
    const t = sumFinance([row({ confirmed_cents: 70 }), row({ confirmed_cents: 35, reversed_cents: 35 })]);
    expect(t.confirmedIncomeCents).toBe(70);
  });
  it("salon payment volume stays separate from GlowSuite income", () => {
    const t = sumFinance([row({ gross_cents: 10000, refund_cents: 1000, net_cents: 9000 })]);
    expect(t.netCents).toBe(9000);
    expect(t.confirmedIncomeCents).toBe(0);
  });
});

describe("platform helpers", () => {
  it("missing amounts show as Niet beschikbaar, not zero", () => {
    expect(formatCents(null)).toBe("Niet beschikbaar");
  });
  it("maps server refusals to Dutch messages", () => {
    expect(platformErrorMessage("mfa_required")).toMatch(/MFA/);
    expect(platformErrorMessage("not_platform_owner")).toMatch(/geen toegang/);
  });
  it("builds 12 month periods", () => {
    const p = lastPeriods(12, new Date("2026-10-14T12:00:00Z"));
    expect(p[0]).toBe("2026-10");
    expect(p[11]).toBe("2025-11");
  });
});
