/**
 * Revenue scoring engine for Omzet Autopilot.
 *
 * Pure functions — no DB writes. Callers decide whether to execute
 * (live mode) or simulate (demo mode) the resulting decisions.
 */

export type AutopilotAction =
  | "waitlist_offer"
  | "whatsapp_blast"
  | "discount_offer"
  | "do_nothing";

export interface SlotInput {
  /** ISO datetime of the empty slot. */
  startsAt: Date;
  /** Average revenue if filled (€). */
  expectedRevenue: number;
}

export interface CustomerSignal {
  id: string;
  name?: string | null;
  total_spent?: number | null;
  no_show_count?: number | null;
  /** ISO date of last appointment, if any. */
  lastVisitAt?: Date | null;
}

export interface ScoredSlot {
  startsAt: Date;
  hoursUntil: number;
  fillProbability: number;
  expectedRevenue: number;
  urgencyMultiplier: number;
  score: number;
  action: AutopilotAction;
  reason: string;
  projectedRevenue: number;
}

export interface ScoredCustomer {
  customer: CustomerSignal;
  rank: number;
  recencyDays: number;
  spendScore: number;
  riskPenalty: number;
}

/** Probability a slot will fill organically given how soon it starts. */
export function computeFillProbability(hoursUntil: number): number {
  if (hoursUntil <= 2) return 0.1;
  if (hoursUntil <= 6) return 0.25;
  if (hoursUntil <= 24) return 0.5;
  if (hoursUntil <= 72) return 0.7;
  return 0.85;
}

/** Higher when slot is sooner — incentivizes acting on imminent gaps. */
export function computeUrgencyMultiplier(hoursUntil: number): number {
  if (hoursUntil <= 2) return 2.0;
  if (hoursUntil <= 6) return 1.6;
  if (hoursUntil <= 24) return 1.2;
  return 1.0;
}

export function decideAction(
  hoursUntil: number,
  fillProbability: number,
): { action: AutopilotAction; reason: string } {
  if (hoursUntil <= 6) {
    return {
      action: "waitlist_offer",
      reason: `Plek over <6u — wachtlijst krijgt direct een aanbod.`,
    };
  }
  if (hoursUntil <= 24) {
    return {
      action: "whatsapp_blast",
      reason: `Plek over <24u — gerichte WhatsApp blast naar top klanten.`,
    };
  }
  if (fillProbability < 0.4) {
    return {
      action: "discount_offer",
      reason: `Lage vulkans (${Math.round(fillProbability * 100)}%) — korting verhoogt boekkans.`,
    };
  }
  return {
    action: "do_nothing",
    reason: `Vulkans hoog (${Math.round(fillProbability * 100)}%) — geen actie nodig.`,
  };
}

export function scoreSlot(slot: SlotInput, now: Date = new Date()): ScoredSlot {
  const hoursUntil = Math.max(0, (slot.startsAt.getTime() - now.getTime()) / 3_600_000);
  const fillProbability = computeFillProbability(hoursUntil);
  const urgencyMultiplier = computeUrgencyMultiplier(hoursUntil);
  const score = fillProbability * slot.expectedRevenue * urgencyMultiplier;
  const { action, reason } = decideAction(hoursUntil, fillProbability);
  const projectedRevenue =
    action === "do_nothing" ? 0 : Math.round(slot.expectedRevenue * fillProbability);
  return {
    startsAt: slot.startsAt,
    hoursUntil,
    fillProbability,
    expectedRevenue: slot.expectedRevenue,
    urgencyMultiplier,
    score,
    action,
    reason,
    projectedRevenue,
  };
}

/** Top N highest-scoring slots that need a real action. */
export function pickTopSlots(slots: SlotInput[], limit = 5, now: Date = new Date()): ScoredSlot[] {
  return slots
    .map((s) => scoreSlot(s, now))
    .filter((s) => s.action !== "do_nothing")
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Rank customers — prefer high spend, recent visits, low no-show risk. */
export function rankCustomers(
  customers: CustomerSignal[],
  now: Date = new Date(),
): ScoredCustomer[] {
  return customers
    .map((c) => {
      const recencyDays = c.lastVisitAt
        ? Math.max(0, (now.getTime() - c.lastVisitAt.getTime()) / 86_400_000)
        : 365;
      const spendScore = Math.min(1, (Number(c.total_spent) || 0) / 500);
      const riskPenalty = Math.min(1, (Number(c.no_show_count) || 0) * 0.2);
      // Prefer recent (<60d), high spend, low risk.
      const recencyScore = Math.max(0, 1 - recencyDays / 90);
      const rank = recencyScore * 0.4 + spendScore * 0.5 - riskPenalty * 0.3;
      return { customer: c, rank, recencyDays, spendScore, riskPenalty };
    })
    .sort((a, b) => b.rank - a.rank);
}

export const ACTION_LABELS: Record<AutopilotAction, string> = {
  waitlist_offer: "Wachtlijst aanbod",
  whatsapp_blast: "WhatsApp blast",
  discount_offer: "Korting actie",
  do_nothing: "Geen actie",
};

/** Dynamic message per action including urgency and a booking link. */
export function buildActionMessage(
  action: AutopilotAction,
  ctx: { hoursUntil: number; bookingLink: string; discountPct?: number },
): string {
  const when = ctx.hoursUntil < 6
    ? `binnen ${Math.max(1, Math.round(ctx.hoursUntil))}u`
    : ctx.hoursUntil < 24
      ? "vandaag"
      : "deze week";
  switch (action) {
    case "waitlist_offer":
      return `Hoi! Er is een plek vrij ${when}. Eerste die boekt krijgt 'm: ${ctx.bookingLink}`;
    case "whatsapp_blast":
      return `Hi 👋 We hebben ${when} nog plek. Snel boeken? ${ctx.bookingLink}`;
    case "discount_offer":
      return `Speciaal voor jou: ${ctx.discountPct ?? 10}% korting als je ${when} boekt 💕 ${ctx.bookingLink}`;
    default:
      return "";
  }
}
