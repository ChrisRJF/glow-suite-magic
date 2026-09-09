// TEMPORARY diagnostic: one controlled Viva ISV connected-account onboarding
// attempt using the official branding structure. No DB writes, no payments.
import { getIsvAccessToken, isvCredentialKind } from "../_shared/vivaIsv.ts";
import { vivaEnv } from "../_shared/viva.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const env = vivaEnv();
  const logoUrl = "https://glowsuite.nl/assets/glowsuite-viva-isv-logo.png";

  let logoStatus: number | null = null;
  let logoType: string | null = null;
  try {
    const l = await fetch(logoUrl, { method: "GET" });
    logoStatus = l.status;
    logoType = l.headers.get("content-type");
    await l.arrayBuffer();
  } catch { /* reported as null */ }

  const payload = {
    email: "demo@glowsuite.nl",
    returnUrl: "https://glowsuite.nl/glowpay",
    branding: {
      partnerName: "GlowSuite",
      logoUrl,
    },
  };
  const serialized = JSON.stringify(payload);

  let oauthOk = false;
  let token = "";
  try {
    token = await getIsvAccessToken();
    oauthOk = true;
  } catch (e) {
    return new Response(JSON.stringify({
      oauth_ok: false,
      oauth_error: String((e as Error).message || e),
      credential_kind: isvCredentialKind(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const url = `${env.api}/isv/v1/accounts`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: serialized,
  });
  const raw = await res.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw: raw.slice(0, 600) }; }

  return new Response(JSON.stringify({
    environment: (Deno.env.get("VIVA_ENVIRONMENT") || "demo").toLowerCase(),
    api_host: env.api,
    credential_kind: isvCredentialKind(),
    oauth_ok: oauthOk,
    endpoint: url,
    serialized_body: serialized,
    request_field_names: Object.keys(payload),
    branding_partner_name_present: true,
    branding_logo_url_present: true,
    root_level_logo_url_present: Object.prototype.hasOwnProperty.call(payload, "logoUrl"),
    logo_http_status: logoStatus,
    logo_content_type: logoType,
    viva_http_status: res.status,
    viva_response: data,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
