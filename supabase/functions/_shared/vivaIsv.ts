// ============================================================================
// GlowSuite Viva ISV layer — canonical merchant scoping.
//
// GlowSuite is the ISV / reseller. Every salon is a Viva connected account
// (merchant). This module is the ONLY place that decides which merchant a Viva
// call runs against, and it always derives that from the authenticated user via
// `glowpay_connected_merchants`. Merchant identifiers are NEVER accepted from a
// request body, the frontend, or a URL parameter.
//
// THREE EXPLICIT CREDENTIAL GROUPS (do not mix them):
//
//   A. ISV OAuth2         VIVA_ISV_CLIENT_ID / VIVA_ISV_CLIENT_SECRET
//                         -> Smart Checkout + ISV payment API calls.
//                         Falls back to the legacy VIVA_CLIENT_ID/SECRET pair
//                         while the dedicated ISV app is being provisioned.
//
//   B. Reseller OAuth2    VIVA_RESELLER_CLIENT_ID / VIVA_RESELLER_CLIENT_SECRET
//                         -> ONLY for Viva's Resellers API (OAuth2 flavour).
//
//   C. ISV Basic auth     username: "<VIVA_RESELLER_ID>:<merchantId>"
//                         password: VIVA_RESELLER_API_KEY
//                         -> transaction/settlement retrieval endpoints that
//                         Viva documents as Basic-auth, reseller scoped.
//
// Nothing here ever logs a secret, a full request/response body, or PII.
// ============================================================================

import { vivaEnv } from "./viva.ts";

// ---------------------------------------------------------------------------
// Credential groups
// ---------------------------------------------------------------------------

export type IsvCredentialKind = "isv" | "legacy" | "none";

export function isvCredentialKind(): IsvCredentialKind {
  if (Deno.env.get("VIVA_ISV_CLIENT_ID") && Deno.env.get("VIVA_ISV_CLIENT_SECRET")) return "isv";
  if (Deno.env.get("VIVA_CLIENT_ID") && Deno.env.get("VIVA_CLIENT_SECRET")) return "legacy";
  return "none";
}

export function hasResellerOAuthCredentials(): boolean {
  return Boolean(
    Deno.env.get("VIVA_RESELLER_CLIENT_ID") && Deno.env.get("VIVA_RESELLER_CLIENT_SECRET"),
  );
}

export function hasResellerBasicCredentials(): boolean {
  return Boolean(Deno.env.get("VIVA_RESELLER_ID") && Deno.env.get("VIVA_RESELLER_API_KEY"));
}

let isvToken: { value: string; expiresAt: number } | null = null;
let resellerToken: { value: string; expiresAt: number } | null = null;

async function oauthToken(clientId: string, clientSecret: string, label: string): Promise<{ access_token: string; expires_in?: number }> {
  const env = vivaEnv();
  const res = await fetch(`${env.account}/connect/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    // Never log the body: it can echo credential fragments.
    const err: any = new Error(`viva_${label}_token_failed`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Group A — ISV OAuth2 access token (Smart Checkout / ISV payment API). */
export async function getIsvAccessToken(): Promise<string> {
  if (isvToken && isvToken.expiresAt > Date.now() + 60_000) return isvToken.value;
  const kind = isvCredentialKind();
  if (kind === "none") throw new Error("viva_isv_not_configured");
  const clientId = kind === "isv" ? Deno.env.get("VIVA_ISV_CLIENT_ID")! : Deno.env.get("VIVA_CLIENT_ID")!;
  const clientSecret = kind === "isv" ? Deno.env.get("VIVA_ISV_CLIENT_SECRET")! : Deno.env.get("VIVA_CLIENT_SECRET")!;
  const data = await oauthToken(clientId, clientSecret, "isv");
  isvToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000,
  };
  return isvToken.value;
}

/** Group B — Resellers API OAuth2 access token. Distinct from group A and C. */
export async function getResellerAccessToken(): Promise<string> {
  if (resellerToken && resellerToken.expiresAt > Date.now() + 60_000) return resellerToken.value;
  if (!hasResellerOAuthCredentials()) throw new Error("viva_reseller_oauth_not_configured");
  const data = await oauthToken(
    Deno.env.get("VIVA_RESELLER_CLIENT_ID")!,
    Deno.env.get("VIVA_RESELLER_CLIENT_SECRET")!,
    "reseller",
  );
  resellerToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000,
  };
  return resellerToken.value;
}

/**
 * Group C — Basic auth header for reseller-scoped transaction endpoints.
 * Username is "<ResellerID>:<MerchantID>", password is the Reseller API key.
 * The merchantId MUST come from the connected merchant mapping.
 */
export function resellerBasicAuthHeader(merchantId: string): string {
  const resellerId = Deno.env.get("VIVA_RESELLER_ID");
  const apiKey = Deno.env.get("VIVA_RESELLER_API_KEY");
  if (!resellerId || !apiKey) throw new Error("viva_reseller_basic_not_configured");
  if (!merchantId) throw new Error("viva_merchant_id_required");
  return `Basic ${btoa(`${resellerId}:${merchantId}:${apiKey}`)}`;
}

// ---------------------------------------------------------------------------
// Safe logging
// ---------------------------------------------------------------------------

/** Mask an identifier so logs stay traceable without being a data leak. */
export function maskId(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 4) return "***";
  return `${s.slice(0, 2)}***${s.slice(-2)}`;
}

export function isvLog(stage: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ scope: "viva_isv", stage, ...fields }));
}

export function isvWarn(stage: string, fields: Record<string, unknown>) {
  console.warn(JSON.stringify({ scope: "viva_isv", stage, ...fields }));
}

// ---------------------------------------------------------------------------
// Connected merchant = source of truth
// ---------------------------------------------------------------------------

export interface ConnectedMerchant {
  id: string;
  user_id: string;
  is_demo: boolean;
  viva_account_id: string | null;
  viva_merchant_id: string | null;
  viva_source_code: string | null;
  reseller_source_code: string | null;
  onboarding_status: string | null;
  setup_complete: boolean;
  setup_incomplete_reason: string | null;
  payouts_enabled: boolean | null;
  terminals_enabled: boolean | null;
  online_payments_enabled: boolean | null;
  business_name: string | null;
}

const ACTIVE_STATUSES = new Set(["connected", "active"]);

export function merchantIsUsable(m: ConnectedMerchant | null): boolean {
  if (!m) return false;
  if (!m.viva_merchant_id) return false;
  if (!ACTIVE_STATUSES.has(String(m.onboarding_status || "").toLowerCase())) return false;
  return true;
}

/**
 * Resolve the Viva merchant for an authenticated GlowSuite user.
 * Server-side only. `userId` must come from a verified JWT, never a body field.
 */
export async function loadConnectedMerchant(
  admin: any,
  userId: string,
  isDemo: boolean,
): Promise<ConnectedMerchant | null> {
  const { data } = await admin
    .from("glowpay_connected_merchants")
    .select("*")
    .eq("user_id", userId)
    .eq("is_demo", isDemo)
    .maybeSingle();
  return (data as ConnectedMerchant) || null;
}

export interface MerchantContext {
  merchant: ConnectedMerchant;
  merchantId: string;
  sourceCode: string | null;
}

export type MerchantContextError =
  | "merchant_not_connected"
  | "merchant_not_active"
  | "merchant_id_missing"
  | "merchant_source_code_missing";

export interface MerchantContextResult {
  ok: boolean;
  context?: MerchantContext;
  error?: MerchantContextError;
  message?: string;
}

/**
 * Canonical live merchant context for payment creation.
 *
 * There is deliberately NO global VIVA_SOURCE_CODE fallback for live connected
 * merchants: an unknown merchant source code means "setup incomplete", not
 * "use the platform default", which would route money to the wrong account.
 */
export async function requireMerchantContext(
  admin: any,
  userId: string,
): Promise<MerchantContextResult> {
  const merchant = await loadConnectedMerchant(admin, userId, false);
  if (!merchant) {
    return { ok: false, error: "merchant_not_connected", message: "GlowPay is nog niet gekoppeld voor deze salon." };
  }
  if (!merchant.viva_merchant_id) {
    return { ok: false, error: "merchant_id_missing", message: "De Viva merchant-koppeling is nog niet compleet." };
  }
  if (!ACTIVE_STATUSES.has(String(merchant.onboarding_status || "").toLowerCase())) {
    return { ok: false, error: "merchant_not_active", message: "De GlowPay-koppeling van deze salon is nog niet actief." };
  }
  const sourceCode = (merchant.viva_source_code || "").trim() || null;
  if (!sourceCode) {
    return {
      ok: false,
      error: "merchant_source_code_missing",
      message: "De betaalcode (source code) van deze salon is nog niet bekend bij GlowSuite.",
    };
  }
  return { ok: true, context: { merchant, merchantId: merchant.viva_merchant_id, sourceCode } };
}

// ---------------------------------------------------------------------------
// Smart Checkout — ISV order creation in merchant scope
// ---------------------------------------------------------------------------

export interface CreateIsvOrderArgs {
  merchantId: string;
  sourceCode: string;
  amountCents: number;
  description: string;
  customerEmail?: string;
  customerFullName?: string;
  customerPhone?: string;
  merchantTrns?: string;
  customerTrns?: string;
  successUrl?: string;
  failureUrl?: string;
  /**
   * ISV commission in cents. Left at 0 / omitted until the commercial ISV fee
   * is contractually agreed with Viva. Do NOT enable speculatively.
   */
  isvAmountCents?: number;
}

export interface CreateIsvOrderResult {
  orderCode: string;
  merchantId: string;
  sourceCode: string;
}

/**
 * Create a Viva Smart Checkout order in the scope of a connected merchant.
 *
 * Auth: ISV OAuth2 bearer (group A).
 * Merchant scoping: the ISV Payment API identifies the target merchant through
 * the `merchantId` field on the order plus the merchant's own payment source
 * code. Both are read from the connected merchant mapping by the caller.
 */
export async function createVivaIsvOrder(args: CreateIsvOrderArgs): Promise<CreateIsvOrderResult> {
  const env = vivaEnv();
  const token = await getIsvAccessToken();

  const payload: Record<string, unknown> = {
    amount: Math.round(args.amountCents),
    merchantId: args.merchantId,
    sourceCode: args.sourceCode,
    customerTrns: (args.customerTrns || args.description).slice(0, 100),
    merchantTrns: (args.merchantTrns || args.description).slice(0, 100),
    requestLang: "nl-NL",
    paymentTimeout: 1800,
    preauth: false,
    allowRecurring: false,
    maxInstallments: 1,
    paymentNotification: true,
    tipAmount: 0,
    disableExactAmount: false,
    disableCash: true,
    disableWallet: false,
  };
  const isvAmount = Math.max(0, Math.round(args.isvAmountCents || 0));
  if (isvAmount > 0) payload.isvAmount = isvAmount;

  if (args.customerEmail || args.customerFullName || args.customerPhone) {
    payload.customer = {
      email: args.customerEmail || undefined,
      fullName: args.customerFullName || undefined,
      phone: args.customerPhone || undefined,
      countryCode: "NL",
      requestLang: "nl-NL",
    };
  }
  if (args.successUrl) payload.successUrl = args.successUrl;
  if (args.failureUrl) payload.failureUrl = args.failureUrl;

  const url = `${env.api}/checkout/v2/orders`;
  isvLog("order_request", {
    merchant_id: maskId(args.merchantId),
    amount_cents: Math.round(args.amountCents),
    isv_amount_cents: isvAmount,
    environment: (Deno.env.get("VIVA_ENVIRONMENT") || "demo").toLowerCase(),
    credential_kind: isvCredentialKind(),
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }

  isvLog("order_response", {
    merchant_id: maskId(args.merchantId),
    http_status: res.status,
    ok: res.ok,
    viva_error_code: data?.ErrorCode ?? data?.errorCode ?? null,
    order_code: data?.orderCode != null ? String(data.orderCode) : null,
  });

  if (!res.ok || data?.orderCode == null) {
    const err: any = new Error(`viva_isv_order_failed_${res.status}`);
    err.status = res.status;
    err.vivaErrorCode = data?.ErrorCode ?? data?.errorCode ?? null;
    throw err;
  }
  return { orderCode: String(data.orderCode), merchantId: args.merchantId, sourceCode: args.sourceCode };
}

// ---------------------------------------------------------------------------
// Reseller transaction retrieval (group C)
// ---------------------------------------------------------------------------

export interface IsvTransaction {
  transactionId: string | null;
  orderCode: string | null;
  statusId: string | null;
  amountCents: number;
  merchantId: string;
  raw: Record<string, unknown>;
}

async function resellerGet(merchantId: string, path: string): Promise<any> {
  const env = vivaEnv();
  const res = await fetch(`${env.api}${path}`, {
    headers: { Authorization: resellerBasicAuthHeader(merchantId), Accept: "application/json" },
  });
  const raw = await res.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  isvLog("reseller_retrieval", {
    merchant_id: maskId(merchantId),
    path,
    http_status: res.status,
    ok: res.ok,
    viva_error_code: data?.ErrorCode ?? data?.errorCode ?? null,
  });
  if (!res.ok) {
    const err: any = new Error(`viva_reseller_retrieval_failed_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function normalizeTransaction(data: any, merchantId: string): IsvTransaction {
  const row = Array.isArray(data) ? data[0] : (data?.transactions?.[0] ?? data?.Transactions?.[0] ?? data);
  return {
    transactionId: row?.transactionId != null ? String(row.transactionId) : (row?.TransactionId != null ? String(row.TransactionId) : null),
    orderCode: row?.orderCode != null ? String(row.orderCode) : (row?.OrderCode != null ? String(row.OrderCode) : null),
    statusId: row?.statusId != null ? String(row.statusId) : (row?.StatusId != null ? String(row.StatusId) : null),
    amountCents: Math.round(Number(row?.amount ?? row?.Amount ?? 0) * 100),
    merchantId,
    raw: row || {},
  };
}

/**
 * Retrieve a transaction in reseller/merchant scope, by transaction ID.
 * `merchantId` MUST originate from the connected merchant mapping.
 */
export async function getIsvTransactionById(merchantId: string, transactionId: string): Promise<IsvTransaction> {
  const data = await resellerGet(merchantId, `/checkout/v2/transactions/${encodeURIComponent(transactionId)}`);
  return normalizeTransaction(data, merchantId);
}

/** Retrieve transaction(s) for an order code in reseller/merchant scope. */
export async function getIsvTransactionByOrderCode(merchantId: string, orderCode: string): Promise<IsvTransaction> {
  const data = await resellerGet(merchantId, `/checkout/v2/orders/${encodeURIComponent(orderCode)}/transactions`);
  return normalizeTransaction(data, merchantId);
}

/** Merchant-scoped settlement/acquiring transactions for payout reconciliation. */
export async function getIsvSettlements(merchantId: string, fromDate: string, toDate: string): Promise<any[]> {
  const data = await resellerGet(merchantId, `/acquiring/v1/transactions?DateFrom=${fromDate}&DateTo=${toDate}`);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.transactions)) return data.transactions;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}
