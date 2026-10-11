// Guards for "Afrekenen vanuit afspraak". Used only on the appointment_checkout path of the provider
// functions; every other payment flow keeps its existing behaviour.
import type { LedgerDeps } from "./providerLedger.ts";

export const CHECKOUT_MARKER = "appointment_checkout";
const CHECKOUT_ROLES = new Set(["eigenaar", "admin", "manager", "receptie"]);

export function isCheckoutPayment(meta: unknown): boolean {
  return !!meta && typeof meta === "object" && (meta as Record<string, unknown>).checkout === CHECKOUT_MARKER;
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Only the appointment-checkout Edge Function knows this server-side value; browsers never do. */
export function isInternalCheckoutCall(req: Request, serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""): boolean {
  return safeEqual(req.headers.get("x-glowsuite-checkout") ?? "", serviceKey);
}

/** Salon (tenant) for a verified user: owner = own id; staff = single active membership with a checkout role. */
export async function resolveCheckoutTenant(admin: any, userId: string): Promise<{ tenantId: string; role: string } | null> {
  const owner = await admin.from("user_roles").select("user_id").eq("user_id", userId).eq("role", "eigenaar").limit(1);
  if (owner.error) return null;
  if ((owner.data ?? []).length) return { tenantId: userId, role: "eigenaar" };
  const m = await admin.from("user_access").select("owner_user_id, role").eq("member_user_id", userId).eq("status", "active");
  if (m.error) return null;
  const rows = (m.data ?? []) as Array<{ owner_user_id: string; role: string }>;
  if (new Set(rows.map((r) => r.owner_user_id)).size !== 1) return null;
  const role = String(rows[0].role);
  return CHECKOUT_ROLES.has(role) ? { tenantId: rows[0].owner_user_id, role } : null;
}

/** Demo/live of a salon is decided only by its stored settings, never by the request. Unreadable = null (block). */
export async function tenantIsDemo(admin: any, tenantId: string): Promise<boolean | null> {
  const s = await admin.from("settings").select("is_demo, demo_mode").eq("user_id", tenantId).order("created_at", { ascending: false }).limit(1);
  if (s.error || !s.data?.[0]) return null;
  return s.data[0].is_demo === true || s.data[0].demo_mode === true;
}

export interface MerchantKyc {
  is_demo: boolean | null; viva_merchant_id: string | null; viva_source_code: string | null;
  onboarding_status: string | null; kyc_status: string | null; setup_complete: boolean | null;
  terminals_enabled: boolean | null; online_payments_enabled: boolean | null;
}
const KYC_OK = new Set(["verified", "approved", "completed", "active"]);
const ONBOARDING_OK = new Set(["connected", "active"]);

/** LIVE checkout needs a fully verified merchant with the capability for this method. Anything unclear = blocked. */
export function liveKycReady(m: MerchantKyc | null, method: "terminal" | "link"): boolean {
  if (!m || m.is_demo !== false) return false;
  if (!m.viva_merchant_id || !(m.viva_source_code ?? "").trim()) return false;
  if (!ONBOARDING_OK.has(String(m.onboarding_status ?? "").toLowerCase())) return false;
  if (!KYC_OK.has(String(m.kyc_status ?? "").toLowerCase())) return false;
  if (m.setup_complete !== true) return false;
  return method === "terminal" ? m.terminals_enabled === true : m.online_payments_enabled === true;
}

export async function loadLiveKyc(admin: any, tenantId: string): Promise<MerchantKyc | null> {
  const r = await admin.from("glowpay_connected_merchants")
    .select("is_demo, viva_merchant_id, viva_source_code, onboarding_status, kyc_status, setup_complete, terminals_enabled, online_payments_enabled")
    .eq("user_id", tenantId).eq("is_demo", false).maybeSingle();
  return r.error ? null : (r.data as MerchantKyc | null);
}

/** Demo salons may only reach the Viva demo environment; live salons only the live one. */
export function environmentMatches(isDemo: boolean, envName: string | undefined): boolean {
  const live = (envName || "demo").toLowerCase() === "live";
  return isDemo ? !live : live;
}

export function makeLedgerDeps(admin: any): LedgerDeps {
  return {
    record: async (e) => {
      const r = await admin.rpc("record_provider_payment", {
        _tenant_id: e.tenantId, _payment_id: e.paymentId, _provider: e.provider, _transaction_id: e.transactionId,
        _kind: e.kind, _amount_cents: e.amountCents, _currency: e.currency, _source: e.source,
      });
      if (r.error) throw r.error;
      return r.data;
    },
    totals: async (tid, aid) => {
      const r = await admin.rpc("appointment_ledger_totals", { _tenant_id: tid, _appointment_id: aid });
      if (r.error) throw r.error;
      const row = Array.isArray(r.data) ? r.data[0] : r.data;
      return { paidCents: Number(row?.paid_cents ?? 0), refundedCents: Number(row?.refunded_cents ?? 0) };
    },
    priceCents: async (tid, aid) => {
      const r = await admin.from("appointments").select("price").eq("id", aid).eq("user_id", tid).maybeSingle();
      if (r.error) throw r.error;
      return r.data?.price == null ? null : Math.round(Number(r.data.price) * 100);
    },
    updateAppointment: async (tid, aid, patch) => {
      const r = await admin.from("appointments").update(patch).eq("id", aid).eq("user_id", tid);
      if (r.error) throw r.error;
    },
  };
}
