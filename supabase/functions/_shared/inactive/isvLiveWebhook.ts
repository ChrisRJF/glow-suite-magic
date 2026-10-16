// Imported by viva-webhook for ISV onboarding events 8193/8194 only.
// The webhook body is a HINT: only ConnectedAccountId is read. Status comes exclusively
// from the authoritative LIVE ISV Retrieve. Never creates, never rebinds, never sets
// source code. Status refresh uses VIVA_ISV_LIVE_ENABLED independently of the charge gate.
import type { Fetch, MerchantRow } from "./isvOnboardingSafety.ts";
import { loadLiveIsvConfig, getLiveIsvToken, type EnvGet } from "./isvLiveConfig.ts";
import { retrieveV2, deriveUpdateV2 } from "./isvOnboardingV2.ts";
import { LIVE_ISV_CHECKOUT_ENABLED } from "./isvLiveCheckout.ts";

export const ISV_ONBOARDING_EVENTS = new Set([8193, 8194]);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isIsvOnboardingEvent(t: number | null | undefined): boolean {
  return typeof t === "number" && ISV_ONBOARDING_EVENTS.has(t);
}

/** Only ConnectedAccountId; never MerchantId/AccountId fallbacks. */
export function connectedAccountId(eventData: unknown): string | null {
  const d = eventData as any;
  const v = d?.ConnectedAccountId ?? d?.connectedAccountId;
  return typeof v === "string" && GUID.test(v.trim()) ? v.trim().toLowerCase() : null;
}

export interface IsvWebhookDeps {
  env: EnvGet;
  fetch: Fetch;
  /** Production uses the global charge gate; injectable only for isolated eligibility tests. */
  checkoutEnabled?: boolean;
  /** LIVE rows (is_demo=false) with this viva_account_id. null = query error. */
  findLiveRows(accountId: string): Promise<MerchantRow[] | null>;
  /** Update scoped by id + user_id + is_demo=false + viva_account_id. false = failed. */
  updateRow(row: MerchantRow, upd: Record<string, unknown>): Promise<boolean>;
}

export type IsvWebhookResult = { processed: boolean; status: 200 | 503; note: string; userId?: string };

export async function handleIsvOnboardingEvent(eventData: unknown, d: IsvWebhookDeps): Promise<IsvWebhookResult> {
  if (!loadLiveIsvConfig(d.env).ok) return { processed: true, status: 200, note: "isv_onboarding_live_disabled" };
  const accountId = connectedAccountId(eventData);
  if (!accountId) return { processed: true, status: 200, note: "isv_onboarding_invalid_account_id" };
  const rows = await d.findLiveRows(accountId);
  if (rows === null) return { processed: false, status: 503, note: "isv_onboarding_lookup_failed" };
  const live = rows.filter((r) => r.is_demo === false && (r.viva_account_id || "").toLowerCase() === accountId);
  if (live.length === 0) return { processed: true, status: 200, note: "isv_onboarding_unknown_account" };
  if (live.length > 1) return { processed: true, status: 200, note: "isv_onboarding_ambiguous_hold" };
  const row = live[0];
  const token = await getLiveIsvToken(d.env, d.fetch);
  if (!token) return { processed: false, status: 503, note: "isv_onboarding_token_unavailable" };
  if (!row.viva_account_id) return { processed: false, status: 503, note: "isv_onboarding_invalid_account_id" };
  const acc = await retrieveV2(row.viva_account_id, "live", token, d.fetch);
  if (!acc) return { processed: false, status: 503, note: "isv_onboarding_retrieve_failed" };
  const upd = deriveUpdateV2(row, acc);
  if (!upd) return { processed: true, status: 200, note: "isv_onboarding_identity_mismatch_hold", userId: row.user_id };
  const eligible = acc.verified && acc.acquiringEnabled && !!acc.merchantId && (!row.viva_merchant_id || acc.merchantId === row.viva_merchant_id);
  const chargingEnabled = d.checkoutEnabled ?? LIVE_ISV_CHECKOUT_ENABLED;
  // Persist provider facts, not an approval toggle. Preserve unrelated merchant metadata.
  const metadata = (row as MerchantRow & { metadata?: Record<string, unknown> }).metadata;
  upd.metadata = { ...(metadata && typeof metadata === "object" ? metadata : {}), viva_account_status: {
    verified: acc.verified, acquiring_enabled: acc.acquiringEnabled, checked_at: upd.last_synced_at,
  } };
  // Global contract gate is not a salon approval toggle. KYC alone cannot open another live route.
  upd.online_payments_enabled = eligible && chargingEnabled;
  upd.payouts_enabled = eligible && chargingEnabled;
  upd.terminals_enabled = false; // Terminal acquiring/physical-source confirmation is separate.
  upd.setup_complete = eligible && chargingEnabled;
  const ok = await d.updateRow(row, upd);
  if (!ok) return { processed: false, status: 503, note: "isv_onboarding_update_failed", userId: row.user_id };
  return { processed: true, status: 200, note: "isv_onboarding_synced", userId: row.user_id };
}

/** Uses the existing five-minute worker. Keyset paging avoids starving later salons. */
export async function refreshLiveMerchants(admin: any, env: EnvGet, fetchFn: Fetch = fetch) {
  const config = loadLiveIsvConfig(env);
  if (!config.ok) return { scanned: 0, synced: 0, failed: 0, blocked: config.reason };
  let after = "", scanned = 0, synced = 0, failed = 0;
  for (;;) {
    let q = admin.from("glowpay_connected_merchants").select("id,user_id,is_demo,viva_account_id,viva_merchant_id,viva_source_code,onboarding_status,kyc_status,metadata")
      .eq("is_demo", false).not("viva_account_id", "is", null).order("id").limit(100);
    if (after) q = q.gt("id", after);
    const r = await q;
    if (r.error) throw r.error;
    const rows: MerchantRow[] = r.data ?? [];
    for (const row of rows) {
      scanned++;
      const result = await handleIsvOnboardingEvent({ ConnectedAccountId: row.viva_account_id }, {
        env, fetch: fetchFn, findLiveRows: async () => [row],
        updateRow: async (expected, upd) => {
          const w = await admin.from("glowpay_connected_merchants").update(upd).eq("id", expected.id).eq("user_id", expected.user_id).eq("is_demo", false).eq("viva_account_id", expected.viva_account_id).select("id");
          return !w.error && w.data?.length === 1;
        },
      });
      if (result.note === "isv_onboarding_synced") synced++;
      else failed++;
    }
    if (rows.length < 100) break;
    const last = rows[rows.length - 1]; if (!last) break; after = last.id;
  }
  return { scanned, synced, failed };
}
