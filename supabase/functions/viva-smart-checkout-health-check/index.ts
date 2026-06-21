// Admin-only: validates the Smart Checkout credential set (VIVA_CLIENT_ID,
// VIVA_CLIENT_SECRET, VIVA_SOURCE_CODE, VIVA_ENVIRONMENT) by requesting an
// OAuth2 client_credentials token from the Viva accounts host.
// Returns only safe, non-secret diagnostic info.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { vivaEnv } from "../_shared/viva.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Admin / eigenaar check
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);

  const { data: isOwner } = await supabase.rpc("has_role", { _user_id: userId, _role: "eigenaar" });
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isOwner && !isAdmin) return json({ error: "forbidden" }, 403);

  const clientId = Deno.env.get("VIVA_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("VIVA_CLIENT_SECRET") || "";
  const sourceCode = Deno.env.get("VIVA_SOURCE_CODE") || "";
  const environment = (Deno.env.get("VIVA_ENVIRONMENT") || "demo").toLowerCase();
  const env = vivaEnv();

  const base = {
    environment,
    has_client_id: Boolean(clientId),
    has_client_secret: Boolean(clientSecret),
    has_source_code: Boolean(sourceCode),
    source_code: sourceCode || null,
    account_host: env.account,
    api_host: env.api,
  };

  if (!clientId || !clientSecret || !sourceCode) {
    return json({
      ...base,
      success: false,
      credential_valid: false,
      http_status: null,
      code: "missing_credentials",
      message: "Smart Checkout credentials ontbreken. Stel VIVA_CLIENT_ID, VIVA_CLIENT_SECRET en VIVA_SOURCE_CODE in.",
    });
  }

  try {
    const basic = btoa(`${clientId}:${clientSecret}`);
    const res = await fetch(`${env.account}/connect/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep raw */ }

    const ok = res.ok && typeof (body as any)?.access_token === "string";
    if (ok) {
      return json({
        ...base,
        success: true,
        credential_valid: true,
        http_status: res.status,
        message: "Smart Checkout credentials geldig.",
      });
    }

    return json({
      ...base,
      success: false,
      credential_valid: false,
      http_status: res.status,
      code: res.status === 400 || res.status === 401 ? "invalid_credentials" : "token_request_failed",
      viva_error: body,
      message: res.status === 400 || res.status === 401
        ? "Smart Checkout credentials zijn ongeldig. Controleer VIVA_CLIENT_ID en VIVA_CLIENT_SECRET."
        : `Kon geen Viva token ophalen (HTTP ${res.status}).`,
    });
  } catch (e: any) {
    return json({
      ...base,
      success: false,
      credential_valid: false,
      http_status: null,
      code: "network_error",
      message: `Netwerkfout bij Viva token request: ${String(e?.message || e).slice(0, 200)}`,
    });
  }
});
