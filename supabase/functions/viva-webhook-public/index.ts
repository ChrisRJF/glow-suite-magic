// Public production webhook endpoint for Viva.
// Intended to be reached via https://hooks.glowpay.nl/viva-webhook
// (DNS/proxy must forward that hostname+path to this edge function).
//
// Behavior:
// - GET/HEAD/OPTIONS  -> HTTP 200 text/plain "OK"
// - POST              -> forward raw body + headers + query params to
//                        viva-webhook-proxy, then respond 200 text/plain "OK"
// Always returns 200 text/plain. No auth. No redirects. No HTML.

const TARGET_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/viva-webhook-proxy`;

const baseHeaders: HeadersInit = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const jsonHeaders: HeadersInit = {
  ...baseHeaders,
  "Content-Type": "application/json; charset=utf-8",
};

const HOP_BY_HOP = new Set([
  "host",
  "content-length",
  "connection",
  "accept-encoding",
  "transfer-encoding",
]);

function ok() {
  return new Response("OK", { status: 200, headers: baseHeaders });
}

// In-memory cache for the Viva webhook verification key.
// Viva expects GET to return { "Key": "<verification key>" }.
// We fetch it on-demand from Viva using existing OAuth credentials so no
// manual VIVA_WEBHOOK_KEY secret has to be configured.
let cachedKey: { value: string; fetchedAt: number } | null = null;
const KEY_TTL_MS = 10 * 60 * 1000; // 10 minutes

function vivaApiBase(): string {
  // Webhook key endpoint lives on the main vivapayments.com domain (not the api subdomain).
  const env = (Deno.env.get("VIVA_ENVIRONMENT") || "demo").toLowerCase();
  return env === "live"
    ? "https://www.vivapayments.com"
    : "https://demo.vivapayments.com";
}

function vivaAccountsBase(): string {
  const env = (Deno.env.get("VIVA_ENVIRONMENT") || "demo").toLowerCase();
  return env === "live"
    ? "https://accounts.vivapayments.com"
    : "https://demo-accounts.vivapayments.com";
}

async function getVivaToken(): Promise<string> {
  const clientId = Deno.env.get("VIVA_CLIENT_ID");
  const clientSecret = Deno.env.get("VIVA_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Viva credentials missing");
  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(`${vivaAccountsBase()}/connect/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    throw new Error(`Viva token error (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.access_token as string;
}

async function fetchVivaWebhookKey(): Promise<string> {
  // 1) Prefer manually configured secret if present.
  const manual = Deno.env.get("VIVA_WEBHOOK_KEY");
  if (manual) return manual;

  // 2) Use cached key while fresh.
  if (cachedKey && Date.now() - cachedKey.fetchedAt < KEY_TTL_MS) {
    return cachedKey.value;
  }

  // 3) Retrieve from Viva. The endpoint requires Bearer auth via OAuth2.
  const url = `${vivaApiBase()}/api/messages/config/token`;
  const token = await getVivaToken();
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) {
    throw new Error(`Viva key fetch error (${res.status} @ ${url}): ${text.slice(0, 300)}`);
  }
  const key = data?.Key || data?.key || "";
  if (!key) throw new Error(`Viva returned no key: ${text.slice(0, 200)}`);
  cachedKey = { value: key, fetchedAt: Date.now() };
  return key;
}

async function okJsonKey() {
  try {
    const key = await fetchVivaWebhookKey();
    console.log(JSON.stringify({
      fn: "viva-webhook-public",
      stage: "key_response",
      source: Deno.env.get("VIVA_WEBHOOK_KEY") ? "secret" : "viva_api",
      key_len: key.length,
    }));
    return new Response(JSON.stringify({ Key: key }), { status: 200, headers: jsonHeaders });
  } catch (err) {
    console.error("[viva-webhook-public] key fetch failed", err);
    // Still return 200 so Viva does not loop on retries; empty key signals misconfig.
    return new Response(JSON.stringify({ Key: "", error: String((err as Error)?.message || err) }), {
      status: 200,
      headers: jsonHeaders,
    });
  }
}


function logRequest(req: Request, extra: Record<string, unknown> = {}) {
  try {
    const url = new URL(req.url);
    console.log(
      JSON.stringify({
        fn: "viva-webhook-public",
        ts: new Date().toISOString(),
        method: req.method,
        path: url.pathname,
        query: url.search,
        ua: req.headers.get("user-agent") || "",
        ip:
          req.headers.get("cf-connecting-ip") ||
          req.headers.get("x-forwarded-for") ||
          req.headers.get("x-real-ip") ||
          "",
        ...extra,
      }),
    );
  } catch (_) {
    // never throw from logging
  }
}

Deno.serve(async (req) => {
  const method = req.method.toUpperCase();
  const keyConfigured = Boolean(Deno.env.get("VIVA_WEBHOOK_KEY"));
  logRequest(req, { viva_webhook_key_configured: keyConfigured });

  if (method === "GET") {
    logRequest(req, { response: "json_key", viva_webhook_key_configured: keyConfigured });
    return await okJsonKey();
  }

  if (method === "HEAD" || method === "OPTIONS") {
    return ok();
  }

  if (method === "POST") {
    try {
      const rawBody = await req.text();

      const forwardedHeaders = new Headers();
      req.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key.toLowerCase())) forwardedHeaders.set(key, value);
      });
      forwardedHeaders.set("x-glowsuite-public-edge", "viva-webhook-public");

      const incoming = new URL(req.url);
      const target = new URL(TARGET_URL);
      incoming.searchParams.forEach((v, k) => target.searchParams.append(k, v));

      // Fire-and-await but never let downstream issues affect the 200 OK response.
      try {
        const upstream = await fetch(target.toString(), {
          method: "POST",
          headers: forwardedHeaders,
          body: rawBody,
        });
        logRequest(req, {
          forwarded: true,
          upstream_status: upstream.status,
          body_bytes: rawBody.length,
        });
      } catch (err) {
        console.error("[viva-webhook-public] forward failed", err);
      }
    } catch (err) {
      console.error("[viva-webhook-public] post handler error", err);
    }
    return ok();
  }

  // Any other method: still return 200 text/plain to avoid breaking provider verification.
  return ok();
});
