// Platform-admin (AAL2) only, explicit five-event confirmation. Never runs on deploy.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { CONFIRM_WORD, registerLiveIsvWebhooksForAdmin } from "../_shared/isvLiveWebhookRegister.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  // Browser preflight: no auth, no side effects. All checks stay on POST.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...corsHeaders, "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let userId: string | null = null, aal: string | null = null;
  if (token) {
    const url = Deno.env.get("SUPABASE_URL"), anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anonKey) return json(503, { error: "auth_unavailable" });
    const sb = createClient(url, anonKey);
    const { data, error } = await sb.auth.getClaims(token);
    if (!error && data?.claims) { userId = (data.claims.sub as string) ?? null; aal = (data.claims.aal as string) ?? null; }
  }
  const body: any = await req.json().catch(() => null);
  const r = await registerLiveIsvWebhooksForAdmin({ userId, aal, confirmed: body?.confirm === CONFIRM_WORD },
    Deno.env.get("PLATFORM_ADMIN_USER_IDS"), (n) => Deno.env.get(n), fetch);
  console.log(JSON.stringify({ fn: "register-viva-isv-live-webhooks", status: r.status, result: r.body.error ?? r.body.events }));
  return json(r.status, r.body);
});
