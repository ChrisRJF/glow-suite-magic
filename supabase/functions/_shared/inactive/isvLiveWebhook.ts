// Imported by viva-webhook for ISV onboarding events 8193/8194 only.
// The webhook body is a HINT: only ConnectedAccountId is read. Status comes exclusively
// from the authoritative LIVE ISV Retrieve. Never creates, never rebinds, never sets
// source code or payment-enabled flags. Default-off via VIVA_ISV_LIVE_ENABLED.
import type { Fetch, MerchantRow } from "./isvOnboardingSafety.ts";
import { loadLiveIsvConfig, getLiveIsvToken, isLivePilotUserAllowed, type EnvGet } from "./isvLiveConfig.ts";
import { retrieveV2, deriveUpdateV2 } from "./isvOnboardingV2.ts";

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
  if (!isLivePilotUserAllowed(row.user_id, d.env)) return { processed: true, status: 200, note: "isv_onboarding_pilot_not_enabled" };
  const token = await getLiveIsvToken(d.env, d.fetch);
  if (!token) return { processed: false, status: 503, note: "isv_onboarding_token_unavailable" };
  const acc = await retrieveV2(row.viva_account_id!, "live", token, d.fetch);
  if (!acc) return { processed: false, status: 503, note: "isv_onboarding_retrieve_failed" };
  const upd = deriveUpdateV2(row, acc);
  if (!upd) return { processed: true, status: 200, note: "isv_onboarding_identity_mismatch_hold", userId: row.user_id };
  for (const k of ["viva_source_code", "online_payments_enabled", "payouts_enabled", "terminals_enabled", "setup_complete"]) delete upd[k];
  const ok = await d.updateRow(row, upd);
  if (!ok) return { processed: false, status: 503, note: "isv_onboarding_update_failed", userId: row.user_id };
  return { processed: true, status: 200, note: "isv_onboarding_synced", userId: row.user_id };
}
