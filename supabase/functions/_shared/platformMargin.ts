// GlowSuite platform margin registration (service role only).
// The margin is stored ONLY via public.record_platform_commission, never in payments.metadata.
import { GLOWPAY_MARGIN_CENTS } from "./glowpayMargin.ts";

export type MarginDecision = "record" | "legacy_already_stored" | "skip_unverified" | "not_applicable";

// Old webhook wrote glowpay_margin_cents only at "paid". Its presence means the margin was already
// counted before the switch (it will be backfilled later). platform_fee_cents alone is NOT a source:
// auto revenue used to set it at link creation, which is not earned commission.
export function marginDecision(i: { isDemo: boolean; isPaid: boolean; txVerified: boolean; meta: Record<string, unknown> | null }): MarginDecision {
  if (i.isDemo || !i.isPaid) return "not_applicable";
  if (i.meta && i.meta.glowpay_margin_cents != null) return "legacy_already_stored";
  if (!i.txVerified) return "skip_unverified";
  return "record";
}

export type RpcFn = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;

// ok=true for 'inserted' and 'duplicate' (repeat webhook). Anything else is a failure the caller must surface.
export async function recordMargin(rpc: RpcFn, paymentId: string): Promise<{ ok: boolean; result: string }> {
  try {
    const { data, error } = await rpc("record_platform_commission", {
      _payment_id: paymentId, _kind: "legacy_margin", _amount_cents: GLOWPAY_MARGIN_CENTS,
      _source: "viva_webhook", _provider_reference: "",
    });
    if (error) return { ok: false, result: "rpc_error" };
    const r = String(data ?? "");
    return r === "inserted" || r === "duplicate" ? { ok: true, result: r } : { ok: false, result: "unexpected_result" };
  } catch {
    return { ok: false, result: "rpc_exception" };
  }
}

// Repeat delivery of an already stored event: skip only when it was fully processed.
export function dedupeDecision(existing: { processed?: boolean | null } | null): "skip" | "reprocess" {
  return existing && existing.processed === true ? "skip" : existing ? "reprocess" : "skip";
}

// Keys the webhook must never (re)write into payments.metadata for new commissions.
export const PLATFORM_MARGIN_META_KEYS = ["platform_fee_cents", "glowpay_margin_cents"] as const;

// ISV payments earn the ISV fee only, never the legacy margin. The ISV marker is TRUSTED only when it
// comes from the service-role-only platform_commission_entries ('expected' row written by the server
// demo route). payments.metadata is salon-writable and is never used for this decision.
export function marginDecisionWithIsv(i: Parameters<typeof marginDecision>[0], trustedIsv: boolean): MarginDecision {
  if (trustedIsv) return "not_applicable";
  return marginDecision(i);
}

type Db = { from: (t: string) => any };
// Fail-safe: on lookup error return "unknown" so the caller retries instead of booking a margin.
export async function trustedIsvLookup(db: Db, paymentId: string): Promise<boolean | "unknown"> {
  try {
    const { data, error } = await db.from("platform_commission_entries").select("id").eq("payment_id", paymentId).eq("kind", "expected").limit(1);
    if (error) return "unknown";
    return Array.isArray(data) && data.length > 0;
  } catch { return "unknown"; }
}
