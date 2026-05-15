// Create or reuse a Viva ISV Connected Account for the current salon.
// Demo mode never calls Viva — onboarding redirect is production-only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getVivaAccessToken, vivaEnv } from "../_shared/viva.ts";

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

    if (isDemo) {
      const message = "Viva onboarding redirect flows are production-only. Use manual demo credentials in demo mode.";
      if (existing) {
        await admin.from("glowpay_connected_merchants").update({
          business_name, contact_email, phone, country,
          metadata: { ...(existing.metadata as any || {}), demo_message: message },
        }).eq("id", existing.id);
        return json({ demo: true, message, account_id: existing.viva_account_id, onboarding_url: existing.onboarding_url });
      }
      const { data: created } = await admin.from("glowpay_connected_merchants").insert({
        user_id: user.id, is_demo: true, business_name, contact_email, phone, country,
        onboarding_status: "not_started", metadata: { demo_message: message },
      }).select("*").maybeSingle();
      return json({ demo: true, message, account_id: null, onboarding_url: null, merchant: created });
    }

    // LIVE — call Viva ISV API
    const env = vivaEnv();
    let token: string;
    try {
      token = await getVivaAccessToken();
    } catch (e) {
      return json({ error: "viva_token_failed", detail: String((e as Error).message || e) }, 502);
    }

    // If existing has viva_account_id, just refresh onboarding link.
    const payload: Record<string, unknown> = {
      sourceCode: Deno.env.get("VIVA_SOURCE_CODE") || undefined,
      businessName: business_name,
      contactEmail: contact_email,
      phone: phone || undefined,
      countryCode: country,
      returnUrl: return_url || undefined,
    };

    // Viva ISV onboarding endpoint (best-effort path; tolerate API drift)
    const url = `${env.api}/isv/v1/connected-accounts`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({} as any));

    if (!res.ok) {
      // Persist the attempt so UI can surface failure context.
      const meta = { last_error: data || { status: res.status }, attempted_at: new Date().toISOString() };
      if (existing) {
        await admin.from("glowpay_connected_merchants").update({
          business_name, contact_email, phone, country,
          metadata: { ...(existing.metadata as any || {}), ...meta },
        }).eq("id", existing.id);
      } else {
        await admin.from("glowpay_connected_merchants").insert({
          user_id: user.id, is_demo: false, business_name, contact_email, phone, country,
          onboarding_status: "not_started", metadata: meta,
        });
      }
      return json({ error: "viva_onboarding_failed", status: res.status, detail: data }, 502);
    }

    const accountId = String(data?.accountId ?? data?.AccountId ?? data?.id ?? "") || null;
    const onboardingUrl = String(data?.onboardingUrl ?? data?.OnboardingUrl ?? data?.url ?? "") || null;
    const merchantId = String(data?.merchantId ?? data?.MerchantId ?? "") || null;

    const baseUpdate = {
      user_id: user.id,
      is_demo: false,
      business_name, contact_email, phone, country,
      viva_account_id: accountId,
      viva_merchant_id: merchantId,
      onboarding_url: onboardingUrl,
      onboarding_status: "invited",
      last_synced_at: new Date().toISOString(),
      metadata: { ...(existing?.metadata as any || {}), last_response: data },
    };

    let row;
    if (existing) {
      const { data: upd } = await admin.from("glowpay_connected_merchants").update(baseUpdate).eq("id", existing.id).select("*").maybeSingle();
      row = upd;
    } else {
      const { data: ins } = await admin.from("glowpay_connected_merchants").insert(baseUpdate).select("*").maybeSingle();
      row = ins;
    }

    return json({ demo: false, account_id: accountId, onboarding_url: onboardingUrl, merchant: row });
  } catch (e) {
    console.error("create-viva-connected-account error", e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
