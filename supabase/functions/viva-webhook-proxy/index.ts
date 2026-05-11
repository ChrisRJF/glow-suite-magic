import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { diagnosticCorsHeaders, okText, safeHeaders, writeWebhookDebugLog } from "../_shared/vivaDiagnostics.ts";

// Temporary reverse proxy for Viva webhook diagnostics.
// curl GET: curl -i "https://ueqhckkuuwdsrjrdczbb.supabase.co/functions/v1/viva-webhook-proxy?check=1"
// curl POST json: curl -i -X POST "https://ueqhckkuuwdsrjrdczbb.supabase.co/functions/v1/viva-webhook-proxy" -H "Content-Type: application/json" --data '{"EventTypeId":1796}'
// curl POST form: curl -i -X POST "https://ueqhckkuuwdsrjrdczbb.supabase.co/functions/v1/viva-webhook-proxy" -H "Content-Type: application/x-www-form-urlencoded" --data 'EventTypeId=1796'

const HOP_BY_HOP = new Set(["host", "content-length", "connection", "accept-encoding"]);

Deno.serve(async (req) => {
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const rawBody = await req.clone().text().catch(() => "");
    await writeWebhookDebugLog(supabase, req, rawBody, "viva-webhook-proxy");

    const forwardedHeaders = new Headers();
    req.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) forwardedHeaders.set(key, value);
    });
    forwardedHeaders.set("x-glowsuite-webhook-proxy", "viva-webhook-proxy");
    forwardedHeaders.set("x-glowsuite-original-headers", JSON.stringify(safeHeaders(req.headers)).slice(0, 6000));

    const target = new URL(`${Deno.env.get("SUPABASE_URL")}/functions/v1/viva-webhook`);
    new URL(req.url).searchParams.forEach((value, key) => target.searchParams.append(key, value));
    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers: forwardedHeaders,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : rawBody,
    });
    const body = await upstream.text().catch(() => "OK");
    return new Response(body || "OK", {
      status: upstream.status || 200,
      headers: { ...diagnosticCorsHeaders, "Content-Type": upstream.headers.get("content-type") || "text/plain" },
    });
  } catch (error) {
    console.error("[viva-webhook-proxy] proxy failed", error);
    return okText();
  }
});