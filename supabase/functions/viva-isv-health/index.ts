// Viva ISV / reseller health check (DEMO + LIVE safe).
//
// Reports ONLY safe status data. Never returns, logs, or echoes any secret
// value, credential fragment, or PII. Credential groups are kept strictly
// separate:
//   A. ISV OAuth2       VIVA_ISV_CLIENT_ID / VIVA_ISV_CLIENT_SECRET
//   B. Reseller OAuth2  VIVA_RESELLER_CLIENT_ID / VIVA_RESELLER_CLIENT_SECRET
//   C. Reseller Basic   VIVA_RESELLER_ID / VIVA_RESELLER_API_KEY (production only)
//   D. POS / Cloud Terminal  VIVA_POS_* (untouched here)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { vivaEnv } from "../_shared/viva.ts";
import {
  isvCredentialKind,
  hasResellerOAuthCredentials,
  hasResellerBasicCredentials,
  getIsvAccessToken,
  getResellerAccessToken,
  loadConnectedMerchant,
  isvLog,
} from "../_shared/vivaIsv.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type AuthState = "ok" | "failed" | "not_configured";

async function probe(fn: () => Promise<string>): Promise<{ state: AuthState; http_status: number | null; oauth_error: string | null }> {
  try {
    await fn();
    return { state: "ok", http_status: 200, oauth_error: null };
  } catch (e: any) {
    return {
      state: "failed",
      http_status: typeof e?.status === "number" ? e.status : null,
      oauth_error: typeof e?.oauthError === "string" ? e.oauthError : null,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const environment = (Deno.env.get("VIVA_ENVIRONMENT") || "demo").toLowerCase();
  const env = vivaEnv();

  const credKind = isvCredentialKind();
  const isvPresent = credKind !== "none";
  const dedicatedIsvCredentials = credKind === "isv";
  const resellerOAuthPresent = hasResellerOAuthCredentials();
  const prodResellerPresent = hasResellerBasicCredentials();

  const isvAuth = isvPresent ? await probe(getIsvAccessToken) : { state: "not_configured" as AuthState, http_status: null, oauth_error: null };
  const resellerAuth = resellerOAuthPresent
    ? await probe(getResellerAccessToken)
    : { state: "not_configured" as AuthState, http_status: null, oauth_error: null };

  // ---- merchant mapping (server-side only, scoped to the caller) ----
  let merchantMapping = "unknown";
  let merchantDetails: Record<string, unknown> = {};
  let userId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    if (authHeader) {
      const { data } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
      userId = data?.user?.id ?? null;
    }

    if (!userId) {
      merchantMapping = "unauthenticated";
    } else {
      const live = await loadConnectedMerchant(admin, userId, false);
      const demo = await loadConnectedMerchant(admin, userId, true);
      const m = environment === "production" ? live : (demo || live);
      if (!m) {
        merchantMapping = "missing";
      } else {
        const hasId = Boolean(m.viva_merchant_id);
        const hasSource = Boolean((m.viva_source_code || "").trim());
        merchantMapping = hasId && hasSource ? "complete" : hasId ? "incomplete_source_code" : "incomplete_merchant_id";
        merchantDetails = {
          merchant_row_present: true,
          merchant_id_present: hasId,
          source_code_present: hasSource,
          connected_account_id_present: Boolean(m.viva_account_id),
          onboarding_status: m.onboarding_status ?? null,
          is_demo: m.is_demo,
        };
      }

      // Terminal ownership: a terminal only counts as merchant-scoped when it
      // is linked to a connected merchant row.
      const { data: terminals } = await admin
        .from("viva_terminals")
        .select("id, connected_merchant_id, viva_account_id, status")
        .eq("user_id", userId);
      const list = terminals || [];
      merchantDetails.terminals_total = list.length;
      merchantDetails.terminals_merchant_scoped = list.filter(
        (t: any) => t.connected_merchant_id || t.viva_account_id,
      ).length;
    }
  } catch (_e) {
    merchantMapping = "lookup_failed";
  }

  const paymentTestSafe = isvAuth.state === "ok" && merchantMapping === "complete";

  const body = {
    environment,
    account_host: env.account,
    api_host: env.api,
    isv_credentials_present: isvPresent,
    isv_credentials_dedicated: dedicatedIsvCredentials,
    isv_auth: isvAuth.state,
    isv_auth_http_status: isvAuth.http_status,
    isv_auth_error: isvAuth.oauth_error,
    reseller_credentials_present: resellerOAuthPresent,
    reseller_auth: resellerAuth.state,
    reseller_auth_http_status: resellerAuth.http_status,
    reseller_auth_error: resellerAuth.oauth_error,
    production_reseller_credentials_present: prodResellerPresent,
    production_reseller_credentials_required_now: environment === "production",
    isv_transaction_retrieval_available: prodResellerPresent,
    merchant_mapping: merchantMapping,
    ...merchantDetails,
    payment_test_safe: paymentTestSafe,
    checked_at: new Date().toISOString(),
  };

  isvLog("health_check", {
    environment,
    isv_auth: isvAuth.state,
    reseller_auth: resellerAuth.state,
    merchant_mapping: merchantMapping,
    payment_test_safe: paymentTestSafe,
  });

  return json(body);
});
