// TEMPORARY read-only capability probe for the Viva DEMO reseller/ISV API.
// Returns HTTP status codes only. No secrets, no bodies, no PII.
import { vivaEnv } from "../_shared/viva.ts";
import { getResellerAccessToken, hasResellerOAuthCredentials } from "../_shared/vivaIsv.ts";

const MERCHANT_ID = "41e4f587-c953-4b02-b3fe-8386c8d9f2ed";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!hasResellerOAuthCredentials()) {
    return new Response(JSON.stringify({ error: "reseller_oauth_not_configured" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const env = vivaEnv();
  const token = await getResellerAccessToken();

  const bases = [env.api, "https://demo.vivapayments.com"];
  const paths = [
    "/api/v1/merchants",
    `/api/v1/merchants/${MERCHANT_ID}`,
    "/api/merchants",
    "/merchants",
    `/merchants/${MERCHANT_ID}`,
    "/api/selfonboarding/v1/merchants",
    "/selfonboarding/v1/merchants",
    "/api/resellers/v1/merchants",
  ];

  const results: Array<Record<string, unknown>> = [];
  for (const base of bases) for (const p of paths) {
    try {
      const res = await fetch(`${base}${p}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const text = await res.text();
      let shape: unknown = null;
      try {
        const j = JSON.parse(text);
        shape = Array.isArray(j) ? `array(${j.length})` : Object.keys(j || {}).slice(0, 12);
      } catch {
        shape = text.slice(0, 60);
      }
      results.push({ path: `${base}${p}`, status: res.status, shape });
    } catch (e) {
      results.push({ path: `${base}${p}`, status: null, error: String((e as Error)?.message || e).slice(0, 80) });
    }
  }

  return new Response(JSON.stringify({ api_host: env.api, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
