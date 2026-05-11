import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { okText, parseVivaPayload, writeWebhookDebugLog } from "../_shared/vivaDiagnostics.ts";

// Temporary Viva diagnostics endpoint.
// curl GET: curl -i "https://ueqhckkuuwdsrjrdczbb.supabase.co/functions/v1/viva-debug-ping?source=manual"
// curl POST json: curl -i -X POST "https://ueqhckkuuwdsrjrdczbb.supabase.co/functions/v1/viva-debug-ping" -H "Content-Type: application/json" --data '{"ping":true}'
// curl POST form: curl -i -X POST "https://ueqhckkuuwdsrjrdczbb.supabase.co/functions/v1/viva-debug-ping" -H "Content-Type: application/x-www-form-urlencoded" --data 'ping=true'

Deno.serve(async (req) => {
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const rawBody = await req.clone().text().catch(() => "");
    await writeWebhookDebugLog(supabase, req, rawBody, "viva-debug-ping");

    const payload = parseVivaPayload(req.headers.get("content-type") || "", rawBody);
    const { error } = await supabase.from("viva_webhook_events").insert({
      event_id: `debug_${crypto.randomUUID()}`,
      event_type: "debug_ping",
      status: "debug",
      processed: true,
      processed_at: new Date().toISOString(),
      raw_payload: {
        method: req.method,
        query: Object.fromEntries(new URL(req.url).searchParams.entries()),
        payload,
      },
    });
    if (error) console.error("[viva-debug-ping] ledger insert failed", error.message);
  } catch (error) {
    console.error("[viva-debug-ping] diagnostics failed", error);
  }
  return okText();
});