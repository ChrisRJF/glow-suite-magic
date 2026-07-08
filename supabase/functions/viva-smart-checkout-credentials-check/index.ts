// Admin-only: masked view of Smart Checkout OAuth credentials.
// Never exposes full secrets. Used to compare with Viva Demo Self-Care portal.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { vivaEnv } from "../_shared/viva.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function maskId(v: string | undefined, firstN: number, lastN: number) {
  if (!v) return { present: false, length: 0 };
  const len = v.length;
  if (len < firstN + lastN + 2) {
    return { present: true, length: len, first: null, last: null, too_short: true };
  }
  const out: Record<string, unknown> = { present: true, length: len };
  out[`first${firstN}`] = v.slice(0, firstN);
  out[`last${lastN}`] = v.slice(-lastN);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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

  const environment = (Deno.env.get("VIVA_ENVIRONMENT") || "demo").toLowerCase();
  const env = vivaEnv();
  const clientId = Deno.env.get("VIVA_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("VIVA_CLIENT_SECRET") || "";
  const sourceCode = Deno.env.get("VIVA_SOURCE_CODE") || "";

  return json({
    VIVA_ENVIRONMENT: environment,
    account_endpoint: `${env.account}/connect/token`,
    api_host: env.api,
    grant_type: "client_credentials",
    source_code_sent_in_oauth: false,
    confirmation: "source_code is not sent in OAuth request",
    VIVA_CLIENT_ID: maskId(clientId, 6, 4),
    VIVA_CLIENT_SECRET: maskId(clientSecret, 4, 4),
    VIVA_SOURCE_CODE: sourceCode || null,
  });
});
