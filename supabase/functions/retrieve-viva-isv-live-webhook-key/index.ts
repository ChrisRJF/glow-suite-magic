// Platform-admin (AAL2) only. POST {"confirm":"fetch_live_isv_webhook_key"}.
// Does nothing on deploy; never logs the key; response is no-store.
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchLiveWebhookKeyForAdmin } from "../_shared/isvLiveWebhookKeyFetch.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let userId: string | null = null, aal: string | null = null;
  if (token) {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data, error } = await sb.auth.getClaims(token);
    if (!error && data?.claims) { userId = (data.claims.sub as string) ?? null; aal = (data.claims.aal as string) ?? null; }
  }
  const body: any = await req.json().catch(() => null);
  const r = await fetchLiveWebhookKeyForAdmin(
    { userId, aal, confirmed: body?.confirm === "fetch_live_isv_webhook_key" },
    Deno.env.get("PLATFORM_ADMIN_USER_IDS"), (n) => Deno.env.get(n), fetch,
  );
  console.log(JSON.stringify({ fn: "retrieve-viva-isv-live-webhook-key", status: r.status, result: r.body.error ?? "ok" }));
  return json(r.status, r.body);
});
