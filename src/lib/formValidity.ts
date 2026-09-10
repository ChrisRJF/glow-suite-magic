/**
 * Presentation only: turns an existing valid_until date into calm wording.
 * No validity is calculated here, the database stays the single source.
 */
export type ValidityTone = "ok" | "soon" | "expired";

export interface ValidityText {
  tone: ValidityTone;
  text: string;
}

const DAY = 24 * 60 * 60 * 1000;

export function formatValidity(validUntil: string | null | undefined, now: Date = new Date()): ValidityText | null {
  if (!validUntil) return null;
  const until = new Date(validUntil);
  if (Number.isNaN(until.getTime())) return null;
  const date = until.toLocaleDateString("nl-NL", { dateStyle: "medium" });
  const days = Math.floor((until.getTime() - now.getTime()) / DAY);
  if (days < 0) return { tone: "expired", text: "Verlopen · opnieuw invullen nodig" };
  if (days <= 30) return { tone: "soon", text: `Verloopt binnenkort · geldig tot ${date}` };
  return { tone: "ok", text: `Geldig tot ${date}` };
}

export const VALIDITY_CLASS: Record<ValidityTone, string> = {
  ok: "text-muted-foreground",
  soon: "text-amber-600",
  expired: "text-destructive",
};
