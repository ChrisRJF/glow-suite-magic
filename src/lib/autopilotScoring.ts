/**
 * Autopilot scoring engine — canonical entry point.
 *
 * Wraps the lower-level `revenueScoring.ts` primitives and exposes the
 * function names used across the Auto Revenue UI and tests.
 *
 * Pure functions only. No DB writes. Callers decide whether to execute
 * (live mode) or simulate (demo mode) the resulting decisions.
 */

import {
  computeFillProbability,
  computeUrgencyMultiplier,
  decideAction,
  scoreSlot,
  pickTopSlots,
  rankCustomers as rankCustomersBase,
  buildActionMessage,
  ACTION_LABELS,
  type AutopilotAction,
  type ScoredSlot,
  type ScoredCustomer,
  type CustomerSignal,
  type SlotInput,
} from "./revenueScoring";

export type {
  AutopilotAction,
  ScoredSlot,
  ScoredCustomer,
  CustomerSignal,
  SlotInput,
};
export { ACTION_LABELS, buildActionMessage, pickTopSlots };

/** Reasons surfaced to the user — clear Dutch trust copy. */
export const REASON_COPY = {
  highProbability: "Geen korting nodig — kans op boeking is al hoog.",
  hardToFill: "Korting voorgesteld omdat dit tijdslot moeilijk te vullen is.",
  imminent: "Plek over <6u — wachtlijst krijgt direct een aanbod.",
  sameDay: "Plek over <24u — gerichte WhatsApp blast naar top klanten.",
  none: "Vulkans hoog — geen actie nodig.",
} as const;

export interface ExtendedSlot extends SlotInput {
  /** Optional: when computing avg from a service set instead of a fixed value. */
  serviceIds?: string[];
  employeeId?: string | null;
}

/* === Required public API === */

export function calculateFillProbability(slot: { startsAt: Date }, now: Date = new Date()): number {
  const hoursUntil = Math.max(0, (slot.startsAt.getTime() - now.getTime()) / 3_600_000);
  return computeFillProbability(hoursUntil);
}

export function calculateExpectedRevenue(services: { price?: number | null }[]): number {
  const prices = services.map((s) => Number(s?.price) || 0).filter((p) => p > 0);
  if (prices.length === 0) return 55;
  return Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
}

export function calculateUrgencyMultiplier(slot: { startsAt: Date }, now: Date = new Date()): number {
  const hoursUntil = Math.max(0, (slot.startsAt.getTime() - now.getTime()) / 3_600_000);
  return computeUrgencyMultiplier(hoursUntil);
}

export function calculateSlotScore(slot: SlotInput, now: Date = new Date()): number {
  return scoreSlot(slot, now).score;
}

export function decideBestAction(
  slot: SlotInput,
  now: Date = new Date(),
): { action: AutopilotAction; reason: string } {
  const hoursUntil = Math.max(0, (slot.startsAt.getTime() - now.getTime()) / 3_600_000);
  return decideAction(hoursUntil, computeFillProbability(hoursUntil));
}

export function rankCustomers(customers: CustomerSignal[], now: Date = new Date()) {
  return rankCustomersBase(customers, now);
}
