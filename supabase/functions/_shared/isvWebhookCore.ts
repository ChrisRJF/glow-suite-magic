// Viva ISV webhook receiver core (EventTypeId 1799, Transaction Price Calculated).
// Viva sends no signature on ISV webhook POSTs, so a received message is only an
// UNVERIFIED technical event: it never changes payments, appointments, refunds,
// revenue, ledger or commissions. Pure logic with injected IO for testing.

export const ISV_PRICE_CALCULATED = 1799;
export const MAX_BODY_BYTES = 64 * 1024;

const HOSTS = {
  demo: { account: "https://demo-accounts.vivapayments.com", api: "https://demo-api.vivapayments.com" },
  live: { account: "https://accounts.vivapayments.com", api: "https://api.vivapayments.com" },
} as const;
export type IsvEnvName = keyof typeof HOSTS;

export function isvEnvName(env: Record<string, string | undefined>): IsvEnvName {
  return (env.VIVA_ENVIRONMENT || "demo").toLowerCase() === "live" ? "live" : "demo";
}
export function isvHosts(name: IsvEnvName) { return HOSTS[name]; }

/** ISV credentials only. No fallback to merchant credentials. */
export function isvCredentials(env: Record<string, string | undefined>): { id: string; secret: string } | null {
  const id = env.VIVA_ISV_CLIENT_ID, secret = env.VIVA_ISV_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Fetch the ISV webhook verification key. Returns null on any failure; never throws secrets. */
export async function fetchIsvVerificationKey(env: Record<string, string | undefined>, fetchFn: Fetch): Promise<string | null> {
  const creds = isvCredentials(env);
  if (!creds) return null;
  const hosts = isvHosts(isvEnvName(env));
  try {
    const t = await fetchFn(`${hosts.account}/connect/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${creds.id}:${creds.secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const tj: any = await t.json().catch(() => ({}));
    if (!t.ok || typeof tj?.access_token !== "string") return null;
    const r = await fetchFn(`${hosts.api}/isv/v1/webhooks/token`, {
      headers: { Authorization: `Bearer ${tj.access_token}`, Accept: "application/json" },
    });
    const rj: any = await r.json().catch(() => ({}));
    const key = rj?.key ?? rj?.Key;
    return r.ok && typeof key === "string" && key.length > 0 ? key : null;
  } catch { return null; }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Isv1799Event {
  eventTypeId: 1799;
  messageId: string | null;
  transactionId: string;
  orderCode: string | null;
  merchantId: string | null;
  /** As reported by Viva, in transaction currency with decimals. UNVERIFIED. */
  reportedIsvFee: number | null;
  currencyCode: string | null;
}

export type ParseResult = { ok: true; event: Isv1799Event } | { ok: false; reason: string };

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown, max = 64): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && s.length <= max ? s : null;
}

export function parseIsv1799(raw: string): ParseResult {
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return { ok: false, reason: "too_large" };
  let p: any;
  try { p = JSON.parse(raw); } catch { return { ok: false, reason: "invalid_json" }; }
  if (!p || typeof p !== "object" || Array.isArray(p)) return { ok: false, reason: "invalid_shape" };
  const typeId = Number(p.EventTypeId ?? p.eventTypeId);
  if (typeId !== ISV_PRICE_CALCULATED) return { ok: false, reason: "unsupported_event_type" };
  const d = p.EventData ?? p.eventData;
  if (!d || typeof d !== "object" || Array.isArray(d)) return { ok: false, reason: "missing_event_data" };
  const tx = str(d.TransactionId ?? d.transactionId);
  if (!tx || !GUID.test(tx)) return { ok: false, reason: "invalid_transaction_id" };
  const order = str(d.OrderCode ?? d.orderCode, 32);
  if (order !== null && !/^\d{1,32}$/.test(order)) return { ok: false, reason: "invalid_order_code" };
  const merchant = str(d.MerchantId ?? d.merchantId);
  if (merchant !== null && !GUID.test(merchant)) return { ok: false, reason: "invalid_merchant_id" };
  return {
    ok: true,
    event: {
      eventTypeId: 1799,
      messageId: str(p.MessageId ?? p.messageId),
      transactionId: tx.toLowerCase(),
      orderCode: order,
      merchantId: merchant ? merchant.toLowerCase() : null,
      reportedIsvFee: num(d.IsvFee ?? d.isvFee),
      currencyCode: str(d.CurrencyCode ?? d.currencyCode, 8),
    },
  };
}

/** One row per environment + transaction: Viva retries collapse onto it. */
export function isvEventKey(env: IsvEnvName, transactionId: string): string {
  return `isv1799:${env}:${transactionId}`;
}

export interface EventStore {
  /** Insert; returns "inserted", "duplicate" or "error" (temporary). */
  insert(row: Record<string, unknown>): Promise<"inserted" | "duplicate" | "error">;
}

export interface HandleResult { status: number; body: string }

/**
 * Record a 1799 message as an unverified technical event. Never touches
 * payments, ledger or commissions. Temporary storage errors return 503 so Viva
 * redelivers; duplicates return 200 without a second row.
 */
export async function handleIsv1799(raw: string, envName: IsvEnvName, store: EventStore): Promise<HandleResult> {
  const parsed = parseIsv1799(raw);
  if (!parsed.ok) return { status: parsed.reason === "too_large" ? 413 : 400, body: "invalid" };
  const e = parsed.event;
  const res = await store.insert({
    event_id: isvEventKey(envName, e.transactionId),
    event_type: "isv_transaction_price_calculated",
    event_type_id: ISV_PRICE_CALCULATED,
    transaction_id: e.transactionId,
    order_code: e.orderCode,
    viva_merchant_id: e.merchantId,
    is_demo: envName === "demo",
    source: "isv_webhook",
    status: "received_unverified",
    processed: false,
    signature_valid: null,
    error: "unverified_no_signature",
    // Whitelisted fields only: no card or customer data.
    raw_payload: {
      verification: "unverified",
      environment: envName,
      message_id: e.messageId,
      reported_isv_fee: e.reportedIsvFee,
      reported_isv_fee_unit: "currency_decimal",
      currency_code: e.currencyCode,
    },
  });
  if (res === "error") return { status: 503, body: "retry" };
  return { status: 200, body: "ok" };
}
