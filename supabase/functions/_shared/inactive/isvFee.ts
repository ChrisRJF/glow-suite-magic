// PREPARED, NOT WIRED. Per-salon ISV fee math. Config comes ONLY from the service-role RPC
// isv_fee_config(tenant) (platform-owner managed); never from the client or salon settings.
export type FeeChannel = "online" | "terminal";
export interface FeeConfig { online_bps: number; online_fixed_cents: number; terminal_bps: number; terminal_fixed_cents: number; source?: string }
export interface FeeBreakdown { channel: FeeChannel; amountCents: number; bps: number; fixedCents: number; feeCents: number; salonNetCents: number }

export const BUILTIN_FEE: FeeConfig = { online_bps: 0, online_fixed_cents: 35, terminal_bps: 150, terminal_fixed_cents: 0, source: "builtin" };
const MAX_BPS = 2000, MAX_FIXED = 10000;
const okInt = (n: unknown, max: number): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;

/** Rejects malformed config (fail-closed: caller must not create an order). */
export function validFeeConfig(c: unknown): c is FeeConfig {
  const x = c as FeeConfig;
  return !!x && okInt(x.online_bps, MAX_BPS) && okInt(x.terminal_bps, MAX_BPS) && okInt(x.online_fixed_cents, MAX_FIXED) && okInt(x.terminal_fixed_cents, MAX_FIXED);
}

/** fee = round_half_up(amount * bps / 10000) + fixed, bounded to 0 <= fee < amount. Included in amount, not added. */
export function computeIsvFee(amountCents: number, cfg: FeeConfig, channel: FeeChannel): FeeBreakdown {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("invalid_amount_cents");
  if (!validFeeConfig(cfg)) throw new Error("invalid_fee_config");
  const bps = channel === "online" ? cfg.online_bps : cfg.terminal_bps;
  const fixedCents = channel === "online" ? cfg.online_fixed_cents : cfg.terminal_fixed_cents;
  const raw = Math.floor((amountCents * bps + 5000) / 10000) + fixedCents;
  const feeCents = Math.max(0, Math.min(raw, amountCents - 1));
  return { channel, amountCents, bps, fixedCents, feeCents, salonNetCents: amountCents - feeCents };
}

/** Fee to give back on a (partial) refund: proportional, half-up, never more than what remains. */
export function refundIsvFeeCents(s: { amountCents: number; feeCents: number; refundedAmountCents: number; refundedFeeCents: number }, refundCents: number): number {
  if (!Number.isInteger(refundCents) || refundCents <= 0 || s.refundedAmountCents + refundCents > s.amountCents) throw new Error("invalid_refund");
  const totalRefunded = s.refundedAmountCents + refundCents;
  const cumulative = totalRefunded === s.amountCents ? s.feeCents : Math.floor((s.feeCents * totalRefunded * 2 + s.amountCents) / (2 * s.amountCents));
  return Math.max(0, Math.min(cumulative - s.refundedFeeCents, s.feeCents - s.refundedFeeCents));
}

/** Snapshot row for public.isv_fee_snapshots (service role), written together with the payment row. */
export function feeSnapshot(paymentId: string, tenantId: string, live: boolean, b: FeeBreakdown) {
  return { payment_id: paymentId, tenant_id: tenantId, channel: b.channel, environment: live ? "live" : "demo",
    amount_cents: b.amountCents, fee_cents: b.feeCents, bps: b.bps, fixed_cents: b.fixedCents };
}
