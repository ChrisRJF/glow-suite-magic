// Sync a Viva ISV connected account status into glowpay_connected_merchants.
// Accepts { user_id?, viva_account_id? }. If no user_id and called by a logged-in
// user, syncs that user's merchant. Tolerates missing/partial Viva responses.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getVivaAccessToken, vivaEnv } from "../_shared/viva.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function pickStatus(data: any): string | null {
  const s = String(data?.status ?? data?.Status ?? data?.onboardingStatus ?? data?.OnboardingStatus ?? "").toLowerCase();
  const allowed = ["not_started","invited","in_progress","connected","kyc_pending","active","rejected","suspended"];
  if (allowed.includes(s)) return s;
  if (s === "pending" || s === "kyc") return "kyc_pending";
  if (s === "verified" || s === "approved") return "active";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: udata } = await userClient.auth.getUser();
    const callerId = udata?.user?.id || null;

    const body = await req.json().catch(() => ({}));
    const targetUserId = body?.user_id || callerId;
    const accountIdInput = body?.viva_account_id || null;

    let query = admin.from("glowpay_connected_merchants").select("*").eq("is_demo", false);
    if (accountIdInput) query = query.eq("viva_account_id", accountIdInput);
    else if (targetUserId) query = query.eq("user_id", targetUserId);
    else return json({ error: "user_id_or_account_id_required" }, 400);

    const { data: merchant } = await query.maybeSingle();
    if (!merchant) return json({ error: "merchant_not_found" }, 404);
    if (!merchant.viva_account_id) return json({ error: "no_viva_account_id" }, 400);

    const env = vivaEnv();
    const token = await getVivaAccessToken();
    const res = await fetch(`${env.api}/isv/v1/connected-accounts/${encodeURIComponent(merchant.viva_account_id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({} as any));

    if (!res.ok) {
      await admin.from("glowpay_connected_merchants").update({
        last_synced_at: new Date().toISOString(),
        metadata: { ...(merchant.metadata as any || {}), last_sync_error: data || { status: res.status } },
      }).eq("id", merchant.id);
      return json({ error: "viva_sync_failed", status: res.status, detail: data }, 502);
    }

    const updates: Record<string, unknown> = { last_synced_at: new Date().toISOString() };
    const newStatus = pickStatus(data);
    if (newStatus) updates.onboarding_status = newStatus;
    if (data?.kycStatus ?? data?.KycStatus) updates.kyc_status = String(data.kycStatus ?? data.KycStatus);
    if (data?.merchantId ?? data?.MerchantId) updates.viva_merchant_id = String(data.merchantId ?? data.MerchantId);
    if (typeof data?.payoutsEnabled === "boolean") updates.payouts_enabled = data.payoutsEnabled;
    if (typeof data?.terminalsEnabled === "boolean") updates.terminals_enabled = data.terminalsEnabled;
    if (typeof data?.onlinePaymentsEnabled === "boolean") updates.online_payments_enabled = data.onlinePaymentsEnabled;
    updates.metadata = { ...(merchant.metadata as any || {}), last_sync_response: data };

    const { data: row } = await admin.from("glowpay_connected_merchants").update(updates).eq("id", merchant.id).select("*").maybeSingle();
    return json({ ok: true, merchant: row });
  } catch (e) {
    console.error("sync-viva-connected-account error", e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
