// Returns Viva configuration status (environment + presence of secrets).
// Read-only, requires auth. Safe to call from settings UI.

import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const clientId = Boolean(Deno.env.get("VIVA_CLIENT_ID"));
  const clientSecret = Boolean(Deno.env.get("VIVA_CLIENT_SECRET"));
  const sourceCode = Boolean(Deno.env.get("VIVA_SOURCE_CODE"));
  const envRaw = (Deno.env.get("VIVA_ENVIRONMENT") || "demo").toLowerCase();
  const environment = envRaw === "live" ? "live" : "demo";
  const configured = clientId && clientSecret && sourceCode;

  return new Response(
    JSON.stringify({
      configured,
      environment,
      credentials_present: clientId && clientSecret,
      source_code_present: sourceCode,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
