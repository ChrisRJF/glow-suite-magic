import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { calculateNoShowRisk as frontend } from "../../docs/prepared-patches/no-show-risk/noShowRisk";
import { calculateNoShowRisk as backend } from "../../docs/prepared-patches/no-show-risk/noShowRisk.backend";
import { decideDeposit } from "../../docs/prepared-patches/no-show-risk/depositDecision";
import { usePaymentRules } from "../../docs/prepared-patches/no-show-risk/usePaymentRules";
import { rankCustomers } from "../../docs/prepared-patches/no-show-risk/revenueScoring";

const history = (completed: number, noShows: number, lateCancellations = 0) =>
  ({ verifiedHistory: { completed, noShows, lateCancellations } });

describe("prepared fair risk contract", () => {
  it("zero outcomes is insufficient, not an adverse signal", () => {
    expect(frontend(history(0, 0))).toMatchObject({ score: 0, hasSufficientData: false, isElevated: false });
  });
  it("many completed visits dilute incidents", () => {
    expect(frontend(history(98, 2))).toMatchObject({ score: 2, isHigh: false });
  });
  it("four timely or unclassified cancellations never imply high risk", () => {
    expect(frontend({ cancellation_count: 4 })).toMatchObject({ score: 0, isHigh: false, penalty: 0 });
    expect(frontend({ ...history(6, 0), cancellation_count: 4 }).score).toBe(0);
  });
  it("two independently verified no-shows imply high risk", () => {
    expect(frontend(history(0, 2))).toMatchObject({ score: 60, isHigh: true });
  });
  it("one outcome alone cannot cause an adverse flag", () => {
    expect(frontend(history(0, 1))).toMatchObject({ score: 0, hasSufficientData: false });
  });
  it("late cancellation weighs less and cannot alone become high risk", () => {
    expect(frontend(history(0, 0, 2)).score).toBe(20);
    expect(frontend(history(0, 0, 10))).toMatchObject({ score: 40, isHigh: false });
    expect(frontend(history(0, 2)).score).toBeGreaterThan(frontend(history(0, 0, 2)).score);
  });
  it.each([null, undefined, {}, { no_show_count: 100, cancellation_count: 100 },
    history(-1, 2), history(0, NaN), history(0, Infinity), history(0, 1.5),
    history(Number.MAX_SAFE_INTEGER, 2), { verifiedHistory: null }])("missing/invalid evidence is neutral: %j", input => {
    expect(frontend(input)).toMatchObject({ score: 0, isHigh: false, isElevated: false, penalty: 0, hasSufficientData: false });
  });
  it("frontend and backend agree over a concrete outcome matrix and legacy inputs", () => {
    for (let c = 0; c <= 30; c++) for (let n = 0; n <= 5; n++) for (let l = 0; l <= 5; l++) {
      expect(backend(history(c, n, l))).toEqual(frontend(history(c, n, l)));
    }
    expect(backend({ cancellation_count: 4 })).toEqual(frontend({ cancellation_count: 4 }));
  });
});

describe("prepared downstream safeguards", () => {
  const settings = { deposit_new_client: false, full_prepay_threshold: 0, deposit_noshow_risk: true, deposit_percentage: 50 };
  const server = (customer: Parameters<typeof decideDeposit>[0]["customer"]) =>
    decideDeposit({ settings, customer, isNewCustomer: false, servicePriceEuros: 80 });
  it("missing data/legacy counters cannot force risk deposits on either side", () => {
    const customer = { id: "synthetic", no_show_count: 10, cancellation_count: 4 };
    expect(server(customer).required).toBe(false);
    const { result } = renderHook(() => usePaymentRules(settings));
    expect(result.current.decide(80, customer, false).required).toBe(false);
  });
  it("medium late-only risk cannot force a deposit", () => {
    expect(server(history(0, 0, 4)).required).toBe(false);
    const { result } = renderHook(() => usePaymentRules(settings));
    expect(result.current.decide(80, { id: "synthetic", ...history(0, 0, 4) }, false).required).toBe(false);
  });
  it("verified high risk retains configured deposit amount with parity", () => {
    expect(server(history(0, 2))).toMatchObject({ required: true, amount_euros: 40 });
    const { result } = renderHook(() => usePaymentRules(settings));
    expect(result.current.decide(80, { id: "synthetic", ...history(0, 2) }, false)).toMatchObject({ required: true, amount: 40 });
  });
  it("unrelated new-client and price policies are not disabled", () => {
    expect(decideDeposit({ settings: { ...settings, deposit_new_client: true }, customer: null,
      isNewCustomer: true, servicePriceEuros: 80 }).amount_euros).toBe(40);
    expect(decideDeposit({ settings: { ...settings, full_prepay_threshold: 150 }, customer: null,
      isNewCustomer: false, servicePriceEuros: 150 }).type).toBe("full");
  });
  it("AutoRevenue does not penalize missing data or ordinary cancellations", () => {
    const ranked = rankCustomers([{ id: "clean" }, { id: "cancelled", cancellation_count: 4 },
      { id: "unknown", no_show_count: 20 }, { id: "verified", ...history(0, 2) }]);
    for (const c of ranked.filter(c => c.customer.id !== "verified")) expect(c.riskPenalty).toBe(0);
    expect(ranked.find(c => c.customer.id === "verified")?.riskPenalty).toBe(0.6);
  });
});