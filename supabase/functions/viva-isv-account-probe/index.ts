// READ-ONLY Viva ISV account discovery probe.
// Performs documented GET calls only. Never mutates Viva or the database.
// Never logs or returns secrets/tokens.
import { vivaEnv } from "../_shared/viva.ts";
import { getIsvAccessToken } from "../_shared/vivaIsv.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const env = vivaEnv();
  const body = await req.json().catch(() => ({} as any));
  const accountId: string | null = body?.account_id ?? null;

  let token: string;
  try {
    token = await getIsvAccessToken();
  } catch (e: any) {
    return json({ error: "isv_auth_failed", oauth_error: e?.oauthError ?? null }, 502);
  }

  const paths = [
    "/isv/v1/connected-accounts",
    ...(accountId ? [`/isv/v1/connected-accounts/${encodeURIComponent(accountId)}`, `/isv/v1/accounts/${encodeURIComponent(accountId)}`] : []),
  ];

  const results: Record<string, unknown>[] = [];
  for (const p of paths) {
    try {
      const res = await fetch(`${env.api}${p}`, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text();
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 400); }
      results.push({ path: p, status: res.status, body: parsed });
    } catch (e) {
      results.push({ path: p, status: null, error: String((e as Error).message || e) });
    }
  }

  return json({ environment: (Deno.env.get("VIVA_ENVIRONMENT") || "demo").toLowerCase(), api_host: env.api, results });
});
