// PREPARED, NOT WIRED. LIVE salon-specific ISV checkout + capability sync + auto-revenue auth.
// No entrypoint imports this. Activation needs: separate GO, verified source-code provisioning
// (see docs/prepared-patches/public-booking-payment-guard/README.md) and a Viva demo end-to-end run.
//
// Documented Viva contract (same as the demo builder in ../vivaIsvPrepared.ts):
//   POST {LIVE_ISV_API_HOST}/checkout/v2/isv/orders?merchantId={salon merchantId}
//   Bearer token from LIVE ISV credentials only (never VIVA_CLIENT_ID / VIVA_SOURCE_CODE).
//   body.sourceCode = the salon merchant's own payment source.
import { LIVE_ISV_API_HOST } from "./isvLiveConfig.ts";
import type { AuthoritativeAccount, MerchantRow } from "./isvOnboardingSafety.ts";
import { onlineIsvFeeCents } from "../vivaIsvPrepared.ts";

/** Stays false until source-code provisioning and LIVE ISV transaction confirmation are proven. */
export const LIVE_ISV_CHECKOUT_ENABLED = false as const;

export interface Capabilities { online_payments_enabled: boolean; terminals_enabled: boolean; reason: string }

/**
 * Capability is derived ONLY from the authoritative ISV Retrieve (webhooks 8193/8194 are hints that
 * trigger a Retrieve). Anything not proven -> both off, so revocation or unknown status deactivates.
 * Idempotent: same inputs give the same result.
 */
export function deriveCapabilities(row: MerchantRow | null, acc: AuthoritativeAccount | null): Capabilities {
  const off = (reason: string): Capabilities => ({ online_payments_enabled: false, terminals_enabled: false, reason });
  if (!row || row.is_demo !== false) return off("not_live_merchant");
  if (!acc || !row.viva_account_id || acc.accountId !== row.viva_account_id) return off("retrieve_unavailable");
  if (acc.verified !== true) return off("kyc_not_verified");
  if (!acc.merchantId || !row.viva_merchant_id || acc.merchantId !== row.viva_merchant_id) return off("merchant_mismatch");
  const sc = (row.viva_source_code ?? "").trim();
  if (!sc || sc === "1234") return off("source_code_missing");
  return { online_payments_enabled: true, terminals_enabled: true, reason: "ok" };
}

export type LiveOrder =
  | { ok: true; url: string; body: Record<string, unknown>; merchantId: string; feeCents: number }
  | { ok: false; error: string };

export function prepareLiveIsvOrder(i: {
  tenantId: string; row: MerchantRow | null; caps: Capabilities; amountCents: number; description: string;
  successUrl: string; failureUrl: string; enabled?: boolean;
}): LiveOrder {
  if (!(i.enabled ?? LIVE_ISV_CHECKOUT_ENABLED)) return { ok: false, error: "live_isv_checkout_disabled" };
  const r = i.row;
  if (!r || r.user_id !== i.tenantId || r.is_demo !== false) return { ok: false, error: "merchant_not_salon" };
  if (!i.caps.online_payments_enabled) return { ok: false, error: i.caps.reason };
  if (!Number.isInteger(i.amountCents) || i.amountCents <= 0) return { ok: false, error: "invalid_amount_cents" };
  const merchantId = r.viva_merchant_id!;
  const feeCents = onlineIsvFeeCents(i.amountCents);
  return {
    ok: true, merchantId, feeCents,
    url: `${LIVE_ISV_API_HOST}/checkout/v2/isv/orders?merchantId=${encodeURIComponent(merchantId)}`,
    body: {
      amount: i.amountCents, isvAmount: feeCents, sourceCode: r.viva_source_code!.trim(),
      customerTrns: i.description.slice(0, 100), merchantTrns: i.description.slice(0, 100),
      paymentTimeout: 1800, preauth: false, allowRecurring: false, maxInstallments: 1, disableCash: true,
      successUrl: i.successUrl, failureUrl: i.failureUrl,
    },
  };
}

export { customerPaymentProvider, authorizeAutoRevenue, type AutoRevenueAuth } from "../customerPaymentAuth.ts";
