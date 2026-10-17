/** Prepared only: complete tenant-scoped outcome history, never browser claims.
 * This score is an indication, not a calibrated probability.
 */
export type NoShowRiskLevel = "laag" | "gemiddeld" | "hoog";
export interface NoShowRiskInput {
  no_show_count?: number | null;
  cancellation_count?: number | null;
  verifiedHistory?: { completed: number; noShows: number; lateCancellations: number } | null;
}
export interface NoShowRisk {
  score: number;
  level: NoShowRiskLevel;
  isElevated: boolean;
  isHigh: boolean;
  penalty: number;
  hasSufficientData: boolean;
}
export function calculateNoShowRisk(input: NoShowRiskInput | null | undefined): NoShowRisk {
  const h = input?.verifiedHistory;
  const valid = h != null && [h.completed, h.noShows, h.lateCancellations]
    .every(n => Number.isSafeInteger(n) && n >= 0);
  const total = valid && h ? h.completed + h.noShows + h.lateCancellations : 0;
  const hasSufficientData = valid && Number.isSafeInteger(total) && total >= 2;
  // Ordinary cancellation_count has no timing evidence and never contributes.
  // Minimum two observed outcomes; late cancellations alone cannot reach high.
  const score = hasSufficientData && h
    ? Math.round(Math.min(100, h.noShows * 30 + Math.min(40, h.lateCancellations * 10),
      100 * (h.noShows + h.lateCancellations * 0.5) / total))
    : 0;
  const level: NoShowRiskLevel = score >= 50 ? "hoog" : score >= 20 ? "gemiddeld" : "laag";
  return { score, level, isElevated: hasSufficientData && level !== "laag",
    isHigh: hasSufficientData && level === "hoog", penalty: score / 100, hasSufficientData };
}
export const NO_SHOW_RISK_LABELS: Record<NoShowRiskLevel, string> = {
  laag: "Laag", gemiddeld: "Gemiddeld", hoog: "Hoog",
};--- a/supabase/functions/_shared/noShowRisk.ts
