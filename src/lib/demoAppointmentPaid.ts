/** Sum of Viva-verified demo approvals for an appointment; null when none. Display only. */
export function demoConfirmedCents(rows: { metadata: unknown }[]): number | null {
  let total = 0; let found = false;
  for (const r of rows) {
    const c = (r.metadata as { demo_provider_confirmation?: { amount_cents?: unknown; environment?: unknown } } | null)?.demo_provider_confirmation;
    if (c && c.environment === "demo" && Number.isInteger(c.amount_cents) && (c.amount_cents as number) > 0) { total += c.amount_cents as number; found = true; }
  }
  return found ? total : null;
}
