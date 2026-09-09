// TEMP diagnostic: GET /isv/v1/accounts/{accountId} using ISV OAuth2 only. Read-only.
const corsHeaders = { "Access-Control-Allow-Origin": "*" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const clientId = Deno.env.get("VIVA_ISV_CLIENT_ID")!;
    const clientSecret = Deno.env.get("VIVA_ISV_CLIENT_SECRET")!;
    const basic = btoa(`${clientId}:${clientSecret}`);
    const tokenRes = await fetch("https://demo-accounts.vivapayments.com/connect/token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData?.access_token) {
      return json({ stage: "oauth", status: tokenRes.status, error: "token_failed" }, 502);
    }

    const accountId = "7afb270c-8fba-448b-a32a-a78f01eea8a5";
    const res = await fetch(`https://demo-api.vivapayments.com/isv/v1/accounts/${accountId}`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const raw = await res.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw: raw.slice(0, 800) }; }

    return json({ stage: "get_account", http_status: res.status, response: data });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
