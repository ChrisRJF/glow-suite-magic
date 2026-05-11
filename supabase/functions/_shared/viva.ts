// Shared Viva Smart Checkout helpers — OAuth2 token + order creation.
// Used by create-viva-payment, viva-webhook, public-booking, create-payment, and create-auto-revenue-payment.

const VIVA_DEMO = {
  account: "https://demo-accounts.vivapayments.com",
  api: "https://demo-api.vivapayments.com",
  checkout: "https://demo.vivapayments.com/web/checkout",
};
const VIVA_LIVE = {
  account: "https://accounts.vivapayments.com",
  api: "https://api.vivapayments.com",
  checkout: "https://www.vivapayments.com/web/checkout",
};

export function vivaEnv() {
  return (Deno.env.get("VIVA_ENVIRONMENT") || "demo").toLowerCase() === "live" ? VIVA_LIVE : VIVA_DEMO;
}

export function isVivaConfigured() {
  return Boolean(
    Deno.env.get("VIVA_CLIENT_ID") &&
    Deno.env.get("VIVA_CLIENT_SECRET") &&
    Deno.env.get("VIVA_SOURCE_CODE"),
  );
}

export function vivaCheckoutUrl(orderCode: string) {
  return `${vivaEnv().checkout}?ref=${orderCode}`;
}

// Token cache lives only within one edge invocation; that is fine.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const env = vivaEnv();
  const clientId = Deno.env.get("VIVA_CLIENT_ID")!;
  const clientSecret = Deno.env.get("VIVA_CLIENT_SECRET")!;
  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(`${env.account}/connect/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    throw new Error(`Viva token error (${res.status}): ${JSON.stringify(data)}`);
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000,
  };
  return cachedToken.value;
}

export type VivaPaymentSource = "public_booking" | "auto_revenue" | "membership" | "manual";
export type VivaPaymentType = "deposit" | "full" | "subscription" | "other";

export interface CreateVivaOrderArgs {
  amountCents: number;
  description: string;
  customerEmail?: string;
  customerFullName?: string;
  customerPhone?: string;
  merchantTrns?: string;
  customerTrns?: string;
  successUrl?: string;
  failureUrl?: string;
  source?: VivaPaymentSource;
  paymentType?: VivaPaymentType;
}

export interface CreateVivaOrderResult {
  orderCode: string; // ALWAYS string
}

export async function createVivaOrder(args: CreateVivaOrderArgs): Promise<CreateVivaOrderResult> {
  const env = vivaEnv();
  const token = await getAccessToken();
  const sourceCode = Deno.env.get("VIVA_SOURCE_CODE")!;

  const payload: Record<string, unknown> = {
    amount: Math.round(args.amountCents),
    sourceCode,
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

  const res = await fetch(`${env.api}/checkout/v2/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.orderCode == null) {
    throw new Error(`Viva order error (${res.status}): ${JSON.stringify(data)}`);
  }
  // CRITICAL: orderCode comes back as number; convert to string for storage.
  return { orderCode: String(data.orderCode) };
}

export interface VivaTransaction {
  transactionId: string;
  orderCode: string;
  statusId: string; // F=success, X=cancelled/failed, A=authorized, etc.
  amount: number; // in cents
  eventTypeId?: number;
}

export async function getVivaTransaction(transactionId: string): Promise<VivaTransaction> {
  const env = vivaEnv();
  const token = await getAccessToken();
  const res = await fetch(`${env.api}/checkout/v2/transactions/${transactionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Viva transaction lookup failed (${res.status}): ${JSON.stringify(data)}`);
  return {
    transactionId: String(data.transactionId ?? transactionId),
    orderCode: String(data.orderCode ?? ""),
    statusId: String(data.statusId ?? ""),
    amount: Math.round(Number(data.amount ?? 0) * 100),
    eventTypeId: data.eventTypeId,
  };
}
