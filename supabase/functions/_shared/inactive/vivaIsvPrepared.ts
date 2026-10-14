// ============================================================================
// PREPARED, NOT ACTIVE. Viva ISV payment requests (terminal + online demo).
// Not imported by any entrypoint. Activation needs a separate GO.
//
// Pure module: env, fetch and merchant lookup are injected, so it can be tested
// locally without Deno, secrets or network. It never falls back to the regular
// merchant credentials (VIVA_CLIENT_ID / VIVA_CLIENT_SECRET).
//
// Viva contracts used:
//   Terminal: POST {api}/ecr/isv/v1/transactions:sale
//             body: sessionId, terminalId, cashRegisterId, amount, currencyCode,
//                   merchantReference, isvDetails { amount, terminalMerchantId,
//                   currencyCode?, sourceCode?, merchantId?, merchantSourceCode? }
//   Online:   POST {api}/checkout/v2/isv/orders?merchantId={merchantId}
//             body: amount, isvAmount, sourceCode (merchant's), customerTrns, ...
//             merchantId is a QUERY parameter, not a body field.
// ============================================================================

export const ISV_ONLINE_FEE_CENTS = 35;          // per successful online transaction
export const ISV_TERMINAL_FEE_BPS = 150;          // 1.5% = 150 basis points
export const EUR_CURRENCY_CODE = 978;

export type Env = Record<string, string | undefined>;

/** Feature flag: only the literal string "true" enables the demo flow. Default off. */
export function isvDemoEnabled(env: Env): boolean {
  return env.VIVA_ISV_DEMO_ENABLED === "true" && (env.VIVA_ENVIRONMENT ?? "demo").toLowerCase() === "demo";
}

/** ISV credentials only. Returns null instead of falling back to merchant credentials. */
export function isvCredentials(env: Env): { clientId: string; clientSecret: string } | null {
  const clientId = (env.VIVA_ISV_CLIENT_ID ?? "").trim();
  const clientSecret = (env.VIVA_ISV_CLIENT_SECRET ?? "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function assertCents(amountCents: number) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("invalid_amount_cents");
}

/** Terminal ISV fee: 1.5% of the sale, half-up to whole cents, never above the sale. */
export function terminalIsvFeeCents(amountCents: number): number {
  assertCents(amountCents);
  const fee = Math.floor((amountCents * ISV_TERMINAL_FEE_BPS + 5000) / 10000); // explicit half-up
  return Math.min(fee, amountCents);
}

/** Online ISV fee: fixed 35 cents, included in (not added to) the customer amount. */
export function onlineIsvFeeCents(amountCents: number): number {
  assertCents(amountCents);
  return Math.min(ISV_ONLINE_FEE_CENTS, amountCents);
}

/** Fee is owed only for a successful (Viva status F) transaction. Processing costs are never part of it. */
export function isvFeeOwedCents(statusId: string | null | undefined, feeCents: number): number {
  return statusId === "F" ? feeCents : 0;
}

/**
 * Platform fee to persist for a paid payment. When an ISV fee was charged, that IS
 * the GlowSuite fee; the legacy flat margin must not be added on top. Already stored
 * values are returned unchanged so retries, webhooks and reconciliation never double count.
 */
export function resolvePlatformFeeCents(meta: Record<string, unknown>, legacyMarginCents: number): { cents: number; alreadyStored: boolean } {
  if (typeof meta.platform_fee_cents === "number") return { cents: meta.platform_fee_cents, alreadyStored: true };
  if (typeof meta.isv_fee_cents === "number") return { cents: meta.isv_fee_cents, alreadyStored: false };
  return { cents: legacyMarginCents, alreadyStored: false };
}

// --- merchant validation ----------------------------------------------------

export interface DemoMerchant {
  is_demo: boolean;
  onboarding_status: string | null;
  viva_merchant_id: string | null;
  viva_source_code: string | null;
  terminals_enabled: boolean | null;
}
export interface DemoTerminal { terminal_id: string | null; is_demo: boolean; merchant_id?: string | null }

export type PrepError =
  | "isv_demo_disabled" | "isv_credentials_missing" | "merchant_not_connected"
  | "merchant_not_demo" | "merchant_not_active" | "merchant_id_missing"
  | "merchant_source_code_missing" | "terminal_missing" | "terminal_merchant_mismatch"
  | "terminals_disabled" | "invalid_amount_cents";

const ACTIVE = new Set(["connected", "active"]);

function checkMerchant(m: DemoMerchant | null): PrepError | null {
  if (!m) return "merchant_not_connected";
  if (m.is_demo !== true) return "merchant_not_demo";
  if (!ACTIVE.has(String(m.onboarding_status ?? "").toLowerCase())) return "merchant_not_active";
  if (!m.viva_merchant_id) return "merchant_id_missing";
  return null;
}

export type Prepared = { ok: true; url: string; query?: Record<string, string>; body: Record<string, unknown>; feeCents: number } | { ok: false; error: PrepError };

/** Build the terminal ISV sale request. Merchant and terminal come only from server-side lookups. */
export function prepareTerminalIsvSale(input: {
  env: Env; merchant: DemoMerchant | null; terminal: DemoTerminal | null;
  amountCents: number; sessionId: string; cashRegisterId: string; merchantReference: string;
  /** Only when Viva requires them for this merchant configuration. */
  extra?: { sourceCode?: string; merchantId?: string; merchantSourceCode?: string };
}): Prepared {
  const { env, merchant, terminal } = input;
  if (!isvDemoEnabled(env)) return { ok: false, error: "isv_demo_disabled" };
  if (!isvCredentials(env)) return { ok: false, error: "isv_credentials_missing" };
  const mErr = checkMerchant(merchant); if (mErr) return { ok: false, error: mErr };
  if (merchant!.terminals_enabled === false) return { ok: false, error: "terminals_disabled" };
  if (!terminal?.terminal_id || terminal.is_demo !== true) return { ok: false, error: "terminal_missing" };
  if (terminal.merchant_id && terminal.merchant_id !== merchant!.viva_merchant_id) return { ok: false, error: "terminal_merchant_mismatch" };
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { ok: false, error: "invalid_amount_cents" };
  const feeCents = terminalIsvFeeCents(input.amountCents);
  const isvDetails: Record<string, unknown> = { amount: feeCents, terminalMerchantId: merchant!.viva_merchant_id, currencyCode: EUR_CURRENCY_CODE };
  if (input.extra?.sourceCode) isvDetails.sourceCode = input.extra.sourceCode;
  if (input.extra?.merchantId) isvDetails.merchantId = input.extra.merchantId;
  if (input.extra?.merchantSourceCode) isvDetails.merchantSourceCode = input.extra.merchantSourceCode;
  return {
    ok: true, feeCents, url: "/ecr/isv/v1/transactions:sale",
    body: {
      sessionId: input.sessionId, terminalId: terminal.terminal_id, cashRegisterId: input.cashRegisterId,
      amount: input.amountCents, currencyCode: EUR_CURRENCY_CODE, merchantReference: input.merchantReference.slice(0, 100),
      isvDetails,
    },
  };
}

/** Build the online ISV order. merchantId goes in the query string; isvAmount is included in amount. */
export function prepareOnlineIsvOrder(input: {
  env: Env; merchant: DemoMerchant | null; amountCents: number; description: string;
  successUrl?: string; failureUrl?: string;
}): Prepared {
  const { env, merchant } = input;
  if (!isvDemoEnabled(env)) return { ok: false, error: "isv_demo_disabled" };
  if (!isvCredentials(env)) return { ok: false, error: "isv_credentials_missing" };
  const mErr = checkMerchant(merchant); if (mErr) return { ok: false, error: mErr };
  const sourceCode = (merchant!.viva_source_code ?? "").trim();
  if (!sourceCode) return { ok: false, error: "merchant_source_code_missing" };
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { ok: false, error: "invalid_amount_cents" };
  const feeCents = onlineIsvFeeCents(input.amountCents);
  const body: Record<string, unknown> = {
    amount: input.amountCents, isvAmount: feeCents, sourceCode,
    customerTrns: input.description.slice(0, 100), merchantTrns: input.description.slice(0, 100),
    paymentTimeout: 1800, preauth: false, allowRecurring: false, maxInstallments: 1, disableCash: true,
  };
  if (input.successUrl) body.successUrl = input.successUrl;
  if (input.failureUrl) body.failureUrl = input.failureUrl;
  return { ok: true, feeCents, url: "/checkout/v2/isv/orders", query: { merchantId: merchant!.viva_merchant_id! }, body };
}
