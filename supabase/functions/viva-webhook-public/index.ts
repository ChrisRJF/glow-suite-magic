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

function okJsonKey() {
  const key = Deno.env.get("VIVA_WEBHOOK_KEY") || "";
  return new Response(JSON.stringify({ Key: key }), { status: 200, headers: jsonHeaders });
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
    return okJsonKey();
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
