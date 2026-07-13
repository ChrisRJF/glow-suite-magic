/**
 * Contract test — frontend and backend no-show risk engines MUST agree on
 * score, level, and flags for every input. Prevents future drift between
 * `src/lib/noShowRisk.ts` (used by every dashboard/component) and
 * `supabase/functions/_shared/noShowRisk.ts` (used by all edge functions,
 * bookings, deposit decisions and schedulers).
 *
 * If this test fails, do NOT edit only one side — update both engines to keep
 * one source of truth.
 */
import { describe, it, expect } from "vitest";
import { calculateNoShowRisk as frontend } from "@/lib/noShowRisk";
// Backend file is dependency-free TS, safe to import directly under vitest.
import { calculateNoShowRisk as backend } from "../../supabase/functions/_shared/noShowRisk";

describe("no-show risk engine — frontend ↔ backend contract", () => {
  const cases: Array<{ no_show_count: number; cancellation_count: number }> = [];
  for (let ns = 0; ns <= 5; ns++) {
    for (let cc = 0; cc <= 7; cc++) {
      cases.push({ no_show_count: ns, cancellation_count: cc });
    }
  }
  // Extra edge cases: nulls, negative-ish, huge numbers.
  const extras: any[] = [
    null,
    undefined,
    {},
    { no_show_count: null, cancellation_count: null },
    { no_show_count: 100, cancellation_count: 100 },
    { no_show_count: -1, cancellation_count: -1 },
  ];

  for (const c of cases) {
    it(`matches for no_show=${c.no_show_count} cancel=${c.cancellation_count}`, () => {
      const f = frontend(c);
      const b = backend(c);
      expect(b.score).toBe(f.score);
      expect(b.level).toBe(f.level);
      expect(b.isElevated).toBe(f.isElevated);
      expect(b.isHigh).toBe(f.isHigh);
      expect(b.penalty).toBeCloseTo(f.penalty, 6);
    });
  }

  for (const c of extras) {
    it(`matches for edge input ${JSON.stringify(c)}`, () => {
      const f = frontend(c);
      const b = backend(c);
      expect(b).toEqual(f);
    });
  }
});
