// PREPARED, NOT ACTIVE. Not imported by any entrypoint.
// Viva ISV merchant onboarding per the DEMO-verified contract (2026-10-15):
//  - POST /isv/v1/accounts requires email, returnUrl, branding { partnerName, logoUrl, primaryColor }
//    and returns { accountId, invitation: { redirectUrl } }.
//  - GET /isv/v1/accounts/{accountId} returns verified:boolean, acquiringEnabled:boolean,
//    merchantId (may be empty), invitation object. No sourceCode.
// Builds on isvOnboardingSafety.ts (webhook-as-hint, session-only sync, dedupe).
import { ISV_HOSTS, type Fetch, type MerchantRow } from "./isvOnboardingSafety.ts";

const UUIDISH = /^[0-9a-fA-F-]{8,64}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Existing real asset (public/assets). The brand green is NOT defined anywhere yet: must be supplied. */
export const GLOWPAY_LOGO_URL = "https://glowsuite.nl/__l5e/assets-v1/6cb294cf-67e9-446d-8fd1-97e0fcfe2d90/glowpay-horizontaal-transparant-v2.png"; // official transparent GlowPay logo, verified public 200 image/png RGBA 1920x421 2026-10-16

export interface Branding { partnerName: string; logoUrl: string; primaryColor: string | null }

/** Build create payload. Refuses (null) when any required field is missing/unsafe. */
export function buildCreatePayload(i: { email: string; returnUrl: string; branding: Branding }) {
  const email = (i.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!/^https:\/\/(www\.)?glowsuite\.nl(\/|$)/.test(i.returnUrl)) return null;
  const b = i.branding;
  if (!b.partnerName.trim() || !/^https:\/\//.test(b.logoUrl) || !b.primaryColor || !HEX.test(b.primaryColor)) return null;
  return { email, returnUrl: i.returnUrl, branding: { partnerName: b.partnerName.trim(), logoUrl: b.logoUrl, primaryColor: b.primaryColor } };
}

/** Invitation URL is accepted only as https on a Viva host. */
export function safeInvitationUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return null;
    return /(^|\.)vivapayments\.com$|(^|\.)viva\.com$|(^|\.)vivawallet\.com$/.test(url.hostname) ? url.toString() : null;
  } catch { return null; }
}

export function parseCreateV2(body: unknown): { accountId: string; redirectUrl: string } | null {
  const b = body as any;
  const accountId = typeof b?.accountId === "string" ? b.accountId : "";
  const redirectUrl = safeInvitationUrl(b?.invitation?.redirectUrl);
  return UUIDISH.test(accountId) && redirectUrl ? { accountId, redirectUrl } : null;
}

export interface AccountV2 { accountId: string; verified: boolean; acquiringEnabled: boolean; merchantId: string | null }

/** Strict Retrieve parse: both booleans must be real booleans, else null (fail closed). */
export function parseRetrieveV2(accountId: string, body: unknown): AccountV2 | null {
  const b = body as any;
  if (!b || typeof b !== "object") return null;
  if (b.accountId !== undefined && b.accountId !== accountId) return null;
  if (typeof b.verified !== "boolean" || typeof b.acquiringEnabled !== "boolean") return null;
  const merchantId = typeof b.merchantId === "string" && UUIDISH.test(b.merchantId) ? b.merchantId : null;
  return { accountId, verified: b.verified, acquiringEnabled: b.acquiringEnabled, merchantId };
}

/** Env isolation: ISV host comes only from ISV env; a row of the other env is never touched. */
export function isvHost(isvEnv: string | undefined): string | null {
  return isvEnv === "demo" ? ISV_HOSTS.demo : isvEnv === "live" ? ISV_HOSTS.live : null;
}
export function envMatches(row: Pick<MerchantRow, "is_demo">, isvEnv: "demo" | "live") { return row.is_demo === (isvEnv === "demo"); }

/** Idempotent per-tenant create. One row per (user_id, env). */
export type CreateStep =
  | { action: "create" }
  | { action: "reuse"; redirectUrl: string }
  | { action: "refresh_invite" } // account exists but stored link missing/unsafe: re-read via Retrieve, never re-create
  | { action: "refuse"; reason: string };
export function decideCreateV2(row: MerchantRow | null, isvEnv: "demo" | "live"): CreateStep {
  if (row && !envMatches(row, isvEnv)) return { action: "refuse", reason: "env_mismatch" };
  if (!row?.viva_account_id) return { action: "create" };
  const s = String(row.onboarding_status).toLowerCase();
  if (["active", "kyc_pending", "connected"].includes(s)) return { action: "refuse", reason: "already_connected" };
  if (["rejected", "suspended"].includes(s)) return { action: "refuse", reason: "manual_review_required" };
  const link = safeInvitationUrl(row.onboarding_url);
  return link ? { action: "reuse", redirectUrl: link } : { action: "refresh_invite" };
}

/** Status update from authoritative Retrieve only. Never sets source code. */
export function deriveUpdateV2(row: MerchantRow, a: AccountV2): Record<string, unknown> | null {
  if (row.viva_account_id !== a.accountId) return null;
  if (row.viva_merchant_id && a.merchantId && row.viva_merchant_id !== a.merchantId) return null;
  const upd: Record<string, unknown> = { last_synced_at: new Date().toISOString() };
  if (a.merchantId) upd.viva_merchant_id = a.merchantId;
  if (a.verified && a.acquiringEnabled && (a.merchantId || row.viva_merchant_id)) { upd.onboarding_status = "active"; upd.kyc_status = "verified"; }
  else if (a.verified) { upd.onboarding_status = "kyc_pending"; upd.kyc_status = "verified"; }
  else { upd.onboarding_status = row.viva_merchant_id || a.merchantId ? "kyc_pending" : "invited"; upd.kyc_status = "pending"; }
  return upd;
}

/** Live payments: verified + acquiring + merchantId + confirmed source code, live env only. */
export function livePaymentAllowedV2(row: MerchantRow | null, a: AccountV2 | null, isvEnv: "demo" | "live") {
  if (!row || !a) return { ok: false, reason: "not_connected" };
  if (isvEnv !== "live" || row.is_demo) return { ok: false, reason: "not_live_env" };
  if (!a.verified) return { ok: false, reason: "kyc_not_verified" };
  if (!a.acquiringEnabled) return { ok: false, reason: "acquiring_disabled" };
  if (!row.viva_merchant_id || !a.merchantId || row.viva_merchant_id.toLowerCase() !== a.merchantId.toLowerCase()) return { ok: false, reason: "merchant_id_missing" };
  if (!(row.viva_source_code || "").trim()) return { ok: false, reason: "source_code_missing" };
  return { ok: true, reason: "ok" };
}

/** Wizard step 3 statuses: booking and payments are separate. */
export type PayStatus = "not_started" | "pending" | "action_needed" | "active";
export function wizardStatus(row: MerchantRow | null, bookingSlug: string | null) {
  const s = String(row?.onboarding_status || "not_started").toLowerCase();
  const payments: PayStatus = !row?.viva_account_id ? "not_started"
    : s === "active" && row.viva_source_code ? "active"
    : ["rejected", "suspended"].includes(s) ? "action_needed" : "pending";
  return { booking: bookingSlug ? "active" : "not_set_up", payments } as const;
}

export async function retrieveV2(accountId: string, isvEnv: "demo" | "live", token: string | null, f: Fetch) {
  if (!token || !UUIDISH.test(accountId)) return null;
  try {
    const r = await f(`${ISV_HOSTS[isvEnv]}/isv/v1/accounts/${encodeURIComponent(accountId)}`, { headers: { Authorization: `Bearer ${token}` } });
    return r.ok ? parseRetrieveV2(accountId, await r.json().catch(() => null)) : null;
  } catch { return null; }
}
