// Retrieve Viva webhook verification key.
// Calls Viva's GET /api/messages/config/token endpoint with OAuth2 bearer token,
// using existing VIVA_CLIENT_ID / VIVA_CLIENT_SECRET / VIVA_ENVIRONMENT secrets.
//
// Returns: { key: "...", configured: true }
//
// Does NOT modify Mollie, booking, appointments, or revenue logic.

import { vivaEnv, getVivaAccessToken, isVivaConfigured } from "../_shared/viva.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  console.log(JSON.stringify({
    fn: "retrieve-viva-webhook-key",
    method: req.method,
    configured: isVivaConfigured(),
    env: (Deno.env.get("VIVA_ENVIRONMENT") || "demo").toLowerCase(),
  }));

  if (!isVivaConfigured()) {
    return json({ error: "Viva credentials not configured", configured: false }, 400);
  }

  try {
    const env = vivaEnv();
    const token = await getVivaAccessToken();
    const res = await fetch(`${env.api}/messages/config/token`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const text = await res.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { /* keep text */ }

    if (!res.ok) {
      console.error("[retrieve-viva-webhook-key] viva error", res.status, text.slice(0, 300));
      return json({ error: "Viva API error", status: res.status, body: text.slice(0, 500) }, 502);
    }

    const key = data?.Key || data?.key || "";
    if (!key) {
      return json({ error: "No key in Viva response", body: text.slice(0, 500) }, 502);
    }

    console.log(JSON.stringify({ fn: "retrieve-viva-webhook-key", retrieved: true, key_len: key.length }));
    return json({ key, configured: true });
  } catch (err) {
    console.error("[retrieve-viva-webhook-key] error", err);
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
