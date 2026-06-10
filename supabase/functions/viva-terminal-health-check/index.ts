// Validates the Viva POS/ECR credential set used by terminal payments.
// Performs an OAuth2 client_credentials token request against the same
// account endpoint and credentials that create-viva-terminal-payment uses.
// Never returns secrets — only environment, credential kind, and status.
import {
  vivaPosEnv,
  getVivaPosAccessToken,
  isVivaPosConfigured,
  vivaPosCredentialKind,
  vivaPosSourceCode,
} from "../_shared/viva.ts";

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

  const credentialKind = vivaPosCredentialKind();
  const environment = (Deno.env.get("VIVA_POS_ENVIRONMENT") || Deno.env.get("VIVA_ENVIRONMENT") || "demo").toLowerCase();
  const env = vivaPosEnv();
  const hasSourceCode = Boolean(vivaPosSourceCode());

  if (!isVivaPosConfigured()) {
    return json({
      success: false,
      configured: false,
      environment,
      credential_kind: credentialKind,
      account_host: env.account,
      api_host: env.api,
      has_source_code: hasSourceCode,
      message: "Viva POS credentials zijn niet geconfigureerd. Stel VIVA_POS_CLIENT_ID en VIVA_POS_CLIENT_SECRET in (of val terug op VIVA_CLIENT_ID/SECRET).",
    }, 200);
  }

  try {
    const { token, kind } = await getVivaPosAccessToken();
    return json({
      success: true,
      configured: true,
      environment,
      credential_kind: kind,
      account_host: env.account,
      api_host: env.api,
      has_source_code: hasSourceCode,
      token_length: token.length,
      message: kind === "pos"
        ? "Dedicated POS credentials geldig."
        : "Smart Checkout credentials gebruikt voor POS (fallback). Configureer VIVA_POS_* voor productie.",
    });
  } catch (e: any) {
    const status = Number(e?.status) || null;
    const isUnauthorized = status === 401;
    return json({
      success: false,
      configured: true,
      environment,
      credential_kind: credentialKind,
      account_host: env.account,
      api_host: env.api,
      has_source_code: hasSourceCode,
      http_status: status,
      code: isUnauthorized ? "invalid_credentials" : "token_request_failed",
      message: isUnauthorized
        ? (environment === "demo"
            ? "GlowPay demo-inloggegevens zijn ongeldig. Controleer de Viva POS API credentials."
            : "GlowPay inloggegevens zijn ongeldig. Controleer de Viva POS API credentials.")
        : `Kon geen Viva token ophalen: ${String(e?.message || e).slice(0, 200)}`,
    }, 200);
  }
});
