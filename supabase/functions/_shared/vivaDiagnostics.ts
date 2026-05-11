import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export const diagnosticCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-viva-signature, x-signature, viva-signature",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS, POST",
};

const SENSITIVE_HEADER = /(authorization|apikey|api-key|cookie|token|secret|signature|password|client-key|client-secret)/i;
const SENSITIVE_BODY_KEY = /(authorization|access_token|refresh_token|client_secret|clientSecret|api_key|apikey|password|secret|signature)/gi;

export function okText(status = 200) {
  return new Response("OK", {
    status,
    headers: { ...diagnosticCorsHeaders, "Content-Type": "text/plain" },
  });
}

export function safeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = SENSITIVE_HEADER.test(key) ? "[redacted]" : value.slice(0, 1000);
  });
  return out;
}

export function querySnapshot(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  url.searchParams.forEach((value, key) => {
    if (out[key] == null) out[key] = value;
    else out[key] = Array.isArray(out[key]) ? [...out[key], value] : [out[key] as string, value];
  });
  return out;
}

export function sourceIp(headers: Headers) {
  return headers.get("cf-connecting-ip")
    || headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || headers.get("x-real-ip")
    || headers.get("forwarded")
    || null;
}

export function safeBodyPreview(rawBody: string, limit = 5000) {
  return rawBody
    .slice(0, limit)
    .replace(new RegExp(`("?${SENSITIVE_BODY_KEY.source}"?\\s*[:=]\\s*)"?[^",&}\\s]+"?`, "gi"), "$1[redacted]");
}

function parseMaybeJson(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

export function parseVivaPayload(contentType: string, rawBody: string): Record<string, unknown> {
  if (!rawBody.trim()) return {};
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(rawBody);
    const payload: Record<string, unknown> = {};
    params.forEach((value, key) => { payload[key] = parseMaybeJson(value); });
    return payload;
  }
  try { return JSON.parse(rawBody); } catch {}
  try {
    const params = new URLSearchParams(rawBody);
    const payload: Record<string, unknown> = {};
    params.forEach((value, key) => { payload[key] = parseMaybeJson(value); });
    return Object.keys(payload).length ? payload : {};
  } catch {
    return {};
  }
}

export async function writeWebhookDebugLog(
  supabase: ReturnType<typeof createClient>,
  req: Request,
  rawBody: string,
  label = "viva-webhook",
) {
  const url = new URL(req.url);
  const headers = safeHeaders(req.headers);
  const preview = safeBodyPreview(rawBody);
  const snapshot = {
    timestamp: new Date().toISOString(),
    method: req.method,
    headers,
    content_type: req.headers.get("content-type") || "",
    user_agent: req.headers.get("user-agent") || "",
    body_size: new TextEncoder().encode(rawBody).length,
    query: querySnapshot(url),
    network: {
      cf_connecting_ip: req.headers.get("cf-connecting-ip") || null,
      x_forwarded_for: req.headers.get("x-forwarded-for") || null,
      x_real_ip: req.headers.get("x-real-ip") || null,
      forwarded: req.headers.get("forwarded") || null,
      source_ip: sourceIp(req.headers),
    },
    body_preview: preview,
  };
  console.log(`[${label}] request-arrival`, JSON.stringify(snapshot));
  const { error } = await supabase.from("viva_webhook_debug_logs").insert({
    method: req.method,
    headers,
    query: snapshot.query,
    body_preview: preview,
    user_agent: snapshot.user_agent,
    source_ip: snapshot.network.source_ip,
  });
  if (error) console.error(`[${label}] debug log insert failed`, error.message);
  return snapshot;
}