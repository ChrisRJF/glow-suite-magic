// Releases held auto-revenue slots whose payment_expires_at has passed.
// Cancels appointment, marks offer expired. Idempotent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const nowIso = new Date().toISOString();

    const { data: expired, error } = await admin
      .from("appointments")
      .select("id, user_id, is_demo")
      .eq("status", "pending_payment")
      .lt("payment_expires_at", nowIso);

    if (error) throw error;
    const ids = (expired || []).map((a) => a.id);

    if (ids.length === 0) return json({ success: true, expired: 0 });

    // Cancel the held appointments (slot is released because it's no longer 'pending_payment'/active)
    await admin
      .from("appointments")
      .update({ status: "geannuleerd", payment_status: "expired", updated_at: new Date().toISOString() })
      .in("id", ids);

    // Mark related offers expired
    await admin
      .from("auto_revenue_offers")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .in("appointment_id", ids)
      .in("status", ["pending_payment", "sent"]);

    return json({ success: true, expired: ids.length });
  } catch (e) {
    console.error("auto-revenue-expire-holds error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
