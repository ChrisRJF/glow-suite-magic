// Viva ISV webhook receiver (separate from merchant viva-webhook).
// GET  -> ISV verification: {"key": "..."} fetched with ISV credentials.
// POST -> EventTypeId 1799 stored only as an unverified technical event.
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchIsvVerificationKey, handleIsv1799, isvEnvName, MAX_BODY_BYTES } from "../_shared/isvWebhookCore.ts";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  const env = Deno.env.toObject();
  const envName = isvEnvName(env);

  if (req.method === "GET") {
    const key = await fetchIsvVerificationKey(env, fetch);
    console.log(JSON.stringify({ fn: "viva-isv-webhook", stage: "verify", env: envName, ok: !!key }));
    if (!key) return text("unavailable", 503);
    return new Response(JSON.stringify({ key }), {
      status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  if (req.method !== "POST") return text("method_not_allowed", 405);

  const len = Number(req.headers.get("content-length") || "0");
  if (len > MAX_BODY_BYTES) return text("invalid", 413);
  const raw = await req.text();

  const supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
  const result = await handleIsv1799(raw, envName, {
    async insert(row) {
      const { error } = await supabase.from("viva_webhook_events").insert(row as any);
      if (!error) return "inserted";
      if ((error as any).code === "23505") return "duplicate";
      return "error";
    },
  });
  console.log(JSON.stringify({ fn: "viva-isv-webhook", stage: "post", env: envName, status: result.status }));
  return text(result.body, result.status);
});
