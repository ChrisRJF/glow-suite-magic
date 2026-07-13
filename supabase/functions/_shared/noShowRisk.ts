/**
 * Canonical server-side no-show risk engine.
 * MUST stay in sync with `src/lib/noShowRisk.ts`.
 *
 *   score = clamp(no_show_count * 30 + cancellation_count * 15, 0..100)
 *   level = score >= 50 ? "hoog" : score >= 20 ? "gemiddeld" : "laag"
 *
 * No extra factors. One shared formula so backend + frontend agree.
 */

export type NoShowRiskLevel = "laag" | "gemiddeld" | "hoog";

export interface NoShowRiskInput {
  no_show_count?: number | null;
  cancellation_count?: number | null;
}

export interface NoShowRisk {
  score: number;
  level: NoShowRiskLevel;
  isElevated: boolean;
  isHigh: boolean;
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
