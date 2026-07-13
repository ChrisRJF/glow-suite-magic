/**
 * Central No-show risk engine.
 *
 * Single source of truth used by:
 * - Dashboard (TodayAtAGlance)
 * - Automations
 * - Customer profile (useCustomerIntelligence)
 * - Coach (DailyCoach)
 * - Deposits (usePaymentRules)
 * - Reminders / revenue scoring (revenueScoring rankCustomers)
 *
 * Rules:
 *   score = clamp(no_show_count * 30 + cancellation_count * 15, 0..100)
 *   level = score >= 50 ? "hoog" : score >= 20 ? "gemiddeld" : "laag"
 *
 * No new factors. Just one shared formula so labels & thresholds agree
 * everywhere.
 */

export type NoShowRiskLevel = "laag" | "gemiddeld" | "hoog";

export interface NoShowRiskInput {
  no_show_count?: number | null;
  cancellation_count?: number | null;
}

export interface NoShowRisk {
  score: number;
  level: NoShowRiskLevel;
  /** Convenience booleans so callers don't re-derive thresholds. */
  isElevated: boolean; // level != "laag"
  isHigh: boolean; // level === "hoog"
  /** Penalty in 0..1 for use in ranking formulas (was ad-hoc in revenueScoring). */
  penalty: number;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function calculateNoShowRisk(input: NoShowRiskInput | null | undefined): NoShowRisk {
  const noShows = Number(input?.no_show_count) || 0;
  const cancels = Number(input?.cancellation_count) || 0;
  const score = clamp(noShows * 30 + cancels * 15);
  const level: NoShowRiskLevel = score >= 50 ? "hoog" : score >= 20 ? "gemiddeld" : "laag";
  return {
    score,
    level,
    isElevated: level !== "laag",
    isHigh: level === "hoog",
    penalty: score / 100,
  };
}

export const NO_SHOW_RISK_LABELS: Record<NoShowRiskLevel, string> = {
  laag: "Laag",
  gemiddeld: "Gemiddeld",
  hoog: "Hoog",
};
