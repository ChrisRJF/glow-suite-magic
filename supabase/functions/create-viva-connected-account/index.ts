// Create or reuse a Viva ISV Connected Account for the current salon.
// Both demo and live call the ISV Connected Accounts API with ISV OAuth2
// credentials (group A). No global platform sourceCode fallback is ever sent:
// the merchant's own source code comes back from Viva after onboarding.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getVivaAccessToken, vivaEnv } from "../_shared/viva.ts";
import { getIsvAccessToken } from "../_shared/vivaIsv.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const business_name = String(body?.business_name || "").trim();
    const contact_email = String(body?.contact_email || user.email || "").trim();
    const phone = body?.phone ? String(body.phone).trim() : null;
    const country = String(body?.country || "NL").trim().toUpperCase();
    const return_url = body?.return_url ? String(body.return_url) : null;

    if (!business_name || !contact_email) return json({ error: "business_name_and_contact_email_required" }, 400);

    // Determine demo mode from settings
    const { data: settings } = await admin
      .from("settings")
      .select("is_demo, demo_mode")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const isDemo = Boolean((settings as any)?.is_demo || (settings as any)?.demo_mode);

    // Upsert by (user_id, is_demo)
    const { data: existing } = await admin
      .from("glowpay_connected_merchants")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_demo", isDemo)
      .maybeSingle();

    // Viva ISV Connected Accounts API — same flow for demo and live, only the
    // host differs (vivaEnv() resolves demo vs production).
    const env = vivaEnv();
    let token: string;
    try {
      token = await getIsvAccessToken();
    } catch (_e) {
      // Legacy platform credentials remain a transitional fallback ONLY for the
      // token itself; merchant scoping is still derived from Viva's response.
      try {
        token = await getVivaAccessToken();
      } catch (e2) {
        return json({ error: "viva_token_failed", detail: String((e2 as Error).message || e2) }, 502);
      }
    }

    // No global VIVA_SOURCE_CODE is sent: the merchant's own payment source
    // code must come back from Viva, never from a platform default.
    const payload: Record<string, unknown> = {
      businessName: business_name,
      contactEmail: contact_email,
      phone: phone || undefined,
      countryCode: country,
      returnUrl: return_url || undefined,
    };

    const url = `${env.api}/isv/v1/connected-accounts`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw: raw.slice(0, 400) }; }

    if (!res.ok) {
      const meta = { last_error: data || { status: res.status }, attempted_at: new Date().toISOString() };
      if (existing) {
        await admin.from("glowpay_connected_merchants").update({
          business_name, contact_email, phone, country,
          metadata: { ...(existing.metadata as any || {}), ...meta },
        }).eq("id", existing.id);
      } else {
        await admin.from("glowpay_connected_merchants").insert({
          user_id: user.id, is_demo: isDemo, business_name, contact_email, phone, country,
          onboarding_status: "not_started", metadata: meta,
        });
      }
      return json({ error: "viva_onboarding_failed", status: res.status, detail: data }, 502);
    }

    const accountId = String(data?.accountId ?? data?.AccountId ?? data?.id ?? "") || null;
    const onboardingUrl = String(data?.onboardingUrl ?? data?.OnboardingUrl ?? data?.url ?? "") || null;
    // merchantId is only stored when Viva actually confirms it. Never guessed.
    const merchantId = String(data?.merchantId ?? data?.MerchantId ?? "") || null;

    const baseUpdate: Record<string, unknown> = {
      user_id: user.id,
      is_demo: isDemo,
      business_name, contact_email, phone, country,
      viva_account_id: accountId,
      onboarding_url: onboardingUrl,
      onboarding_status: "invited",
      last_synced_at: new Date().toISOString(),
      metadata: { ...(existing?.metadata as any || {}), last_response: data },
    };
    if (merchantId) baseUpdate.viva_merchant_id = merchantId;

    let row;
    if (existing) {
      const { data: upd } = await admin.from("glowpay_connected_merchants").update(baseUpdate).eq("id", existing.id).select("*").maybeSingle();
      row = upd;
    } else {
      const { data: ins } = await admin.from("glowpay_connected_merchants").insert(baseUpdate).select("*").maybeSingle();
      row = ins;
    }

    return json({
      demo: isDemo,
      account_id: accountId,
      onboarding_url: onboardingUrl,
      merchant_id_confirmed: Boolean(merchantId),
      merchant: row,
    });

  } catch (e) {
    console.error("create-viva-connected-account error", e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
