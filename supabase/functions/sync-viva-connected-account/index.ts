// LIVE Viva ISV connected-account sync. Tenant comes only from the session (body ignored).
// Uses ONLY the separate LIVE ISV secrets and is off unless VIVA_ISV_LIVE_ENABLED === "true".
// Off/missing config -> 503 before any database read. Status comes only from an
// authoritative Viva Retrieve; any failure writes nothing. Never sets source code.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { syncLiveForSession } from "../_shared/inactive/isvLiveConfig.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const COLS = "id, user_id, is_demo, viva_account_id, viva_merchant_id, viva_source_code, onboarding_status, kyc_status, onboarding_url";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: udata } = await userClient.auth.getUser();
    const sessionUserId = udata?.user?.id || null;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const r = await syncLiveForSession(sessionUserId, {
      get: (n) => Deno.env.get(n),
      fetchFn: fetch,
      findLiveRowByUser: async (uid) => {
        const { data, error } = await admin.from("glowpay_connected_merchants").select(COLS).eq("user_id", uid).eq("is_demo", false).limit(2);
        if (error || (data && data.length > 1)) return "error";
        return (data?.[0] as any) ?? null;
      },
      update: async (id, uid, upd) => {
        const { error } = await admin.from("glowpay_connected_merchants").update(upd).eq("id", id).eq("user_id", uid).eq("is_demo", false);
        return !error;
      },
    });
    return json(r.status === 200 ? { ok: true, result: r.result } : { error: r.result }, r.status);
  } catch (_e) {
    console.error("sync-viva-connected-account failed");
    return json({ error: "internal_error" }, 500);
  }
});
