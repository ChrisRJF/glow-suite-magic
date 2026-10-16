// Imported by create-viva-payment (Smart Checkout) and create-viva-terminal-payment (Cloud Terminal).
// One fail-closed gate before any LIVE provider call or live payment write. Demo/live comes only
// from persisted salon settings (never the request body). LIVE requires: live provider env,
// VIVA_ISV_LIVE_ENABLED=true, stored verified KYC + capability, and an authoritative LIVE ISV Retrieve
// (verified, acquiringEnabled, exact merchantId match, source code). The switch off = no Viva call.
import { tenantIsDemo, loadLiveKyc, liveKycReady, environmentMatches } from "../checkoutGuard.ts";
import { liveAccountStatus, loadLiveIsvConfig, type EnvGet } from "./isvLiveConfig.ts";
import type { Fetch, MerchantRow } from "./isvOnboardingSafety.ts";

export type GateResult = { ok: true; demo: boolean } | { ok: false; demo: boolean | null; reason: string };

export interface GateDeps {
  admin: any;
  env: EnvGet;
  fetch: Fetch;
  /** Provider environment name for this endpoint (Smart Checkout or POS). */
  providerEnv: string | undefined;
}

async function loadLiveRow(admin: any, tenantId: string): Promise<MerchantRow | null | "error"> {
  const r = await admin.from("glowpay_connected_merchants")
    .select("id, user_id, is_demo, viva_account_id, viva_merchant_id, viva_source_code, onboarding_status, kyc_status")
    .eq("user_id", tenantId).eq("is_demo", false).limit(2);
  if (r.error || !Array.isArray(r.data) || r.data.length > 1) return "error";
  return (r.data[0] as MerchantRow) ?? null;
}

export async function livePaymentGate(tenantId: string | null, method: "link" | "terminal", d: GateDeps): Promise<GateResult> {
  if (!tenantId) return { ok: false, demo: null, reason: "unauthorized" };
  const demo = await tenantIsDemo(d.admin, tenantId);
  if (demo === null) return { ok: false, demo: null, reason: "mode_unclear" };
  if (demo) return { ok: true, demo: true };
  if (!environmentMatches(false, d.providerEnv)) return { ok: false, demo: false, reason: "environment_mismatch" };
  if (!loadLiveIsvConfig(d.env).ok) return { ok: false, demo: false, reason: "live_isv_disabled" };
  if (!liveKycReady(await loadLiveKyc(d.admin, tenantId), method)) return { ok: false, demo: false, reason: "kyc_not_ready" };
  const row = await loadLiveRow(d.admin, tenantId);
  if (row === "error" || !row || row.user_id !== tenantId || row.is_demo !== false) return { ok: false, demo: false, reason: "merchant_unclear" };
  const s = await liveAccountStatus(tenantId, row, d.env, d.fetch);
  return s.ok ? { ok: true, demo: false } : { ok: false, demo: false, reason: s.reason };
}
