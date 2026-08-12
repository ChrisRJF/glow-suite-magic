// One-off admin helper: create the Viva ISV demo connected account for an
// explicitly named GlowSuite user. Requires the caller to pass the user_id;
// nothing is guessed. Never returns tokens or secrets.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { vivaEnv } from "../_shared/viva.ts";
import { getIsvAccessToken } from "../_shared/vivaIsv.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({} as any));
  const userId = String(body?.user_id || "").trim();
  const businessName = String(body?.business_name || "").trim();
  const contactEmail = String(body?.contact_email || "").trim();
  const dryRun = body?.dry_run !== false;
  if (!userId || !businessName || !contactEmail) return json({ error: "user_id_business_name_contact_email_required" }, 400);

  const env = vivaEnv();
  let token: string;
  try {
    token = await getIsvAccessToken();
  } catch (e: any) {
    return json({ error: "isv_auth_failed", oauth_error: e?.oauthError ?? null }, 502);
  }

  // Viva's ISV "create account invitation" payload field naming is not
  // consistent across docs; send the documented aliases together.
  const payload = {
    email: contactEmail,
    contactEmail,
    name: businessName,
    businessName,
    companyName: businessName,
    countryCode: "NL",
    country: "NL",
    returnUrl: String(body?.return_url || "https://glowsuite.nl/glowpay"),
    logoUrl: String(body?.logo_url || "https://glowsuite.nl/favicon.ico"),
  };

  const attempts: Record<string, unknown>[] = [];
  const candidatePaths = ["/isv/v1/accounts"];
  let success: { path: string; data: any } | null = null;

  for (const p of candidatePaths) {
    const res = await fetch(`${env.api}${p}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    let parsed: any = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw.slice(0, 400); }
    attempts.push({ path: p, status: res.status, body: parsed });
    if (res.ok) { success = { path: p, data: parsed }; break; }
  }

  if (!success) return json({ ok: false, error: "viva_connected_account_create_failed", attempts }, 502);

  const data = success.data || {};
  const accountId = String(data?.accountId ?? data?.AccountId ?? data?.id ?? "") || null;
  const onboardingUrl = String(data?.onboardingUrl ?? data?.OnboardingUrl ?? data?.url ?? "") || null;
  const merchantId = String(data?.merchantId ?? data?.MerchantId ?? "") || null;

  if (dryRun) return json({ ok: true, dry_run: true, path: success.path, account_id: accountId, onboarding_url: onboardingUrl, merchant_id_confirmed: Boolean(merchantId), raw: data });

  const row: Record<string, unknown> = {
    user_id: userId,
    is_demo: true,
    business_name: businessName,
    contact_email: contactEmail,
    country: "NL",
    viva_account_id: accountId,
    onboarding_url: onboardingUrl,
    onboarding_status: "invited",
    last_synced_at: new Date().toISOString(),
    metadata: { create_response: data, created_via: "viva-isv-connect-demo-merchant" },
  };
  if (merchantId) row.viva_merchant_id = merchantId;

  const { data: existing } = await admin
    .from("glowpay_connected_merchants")
    .select("id")
    .eq("user_id", userId)
    .eq("is_demo", true)
    .maybeSingle();

  const q = existing
    ? admin.from("glowpay_connected_merchants").update(row).eq("id", existing.id).select("*").maybeSingle()
    : admin.from("glowpay_connected_merchants").insert(row).select("*").maybeSingle();
  const { data: saved, error } = await q;
  if (error) return json({ ok: false, error: "db_write_failed", detail: error.message }, 500);

  return json({ ok: true, dry_run: false, account_id: accountId, onboarding_url: onboardingUrl, merchant: saved });
});
