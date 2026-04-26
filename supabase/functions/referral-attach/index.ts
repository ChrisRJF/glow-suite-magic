// Attach a referral to a freshly signed-up user.
// Called from the client right after signup with { code }.
// Requires authenticated user. Idempotent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await userClient.auth.getUser();
    const userId = u?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || "").trim().toUpperCase();
    if (!code || code.length < 4 || code.length > 16) {
      return new Response(JSON.stringify({ ok: false, error: "invalid_code" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Lookup referrer
    const { data: refCode } = await admin
      .from("referral_codes")
      .select("user_id, code")
      .eq("code", code)
      .maybeSingle();

    if (!refCode || refCode.user_id === userId) {
      return new Response(JSON.stringify({ ok: false, error: "no_match_or_self" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotent insert
    const { data: existing } = await admin
      .from("referrals")
      .select("id")
      .eq("referred_user_id", userId)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ ok: true, already: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("referrals").insert({
      referrer_user_id: refCode.user_id,
      referred_user_id: userId,
      code: refCode.code,
      status: "signed_up",
      credit_months: 1,
    });

    // Bump counter
    const { data: cur } = await admin
      .from("referral_codes")
      .select("total_referred")
      .eq("user_id", refCode.user_id)
      .maybeSingle();
    await admin
      .from("referral_codes")
      .update({ total_referred: (cur?.total_referred ?? 0) + 1 })
      .eq("user_id", refCode.user_id);

    // Give referred user 30 extra trial days by extending trial_ends_at
    try {
      const { data: subRow } = await admin
        .from("subscriptions")
        .select("id, trial_ends_at, status")
        .eq("user_id", userId)
        .maybeSingle();
      if (subRow && subRow.status === "trialing") {
        const base = subRow.trial_ends_at ? new Date(subRow.trial_ends_at) : new Date();
        base.setDate(base.getDate() + 30);
        await admin
          .from("subscriptions")
          .update({ trial_ends_at: base.toISOString() })
          .eq("id", subRow.id);
      }
    } catch (e) {
      console.warn("extend trial failed", e);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("referral-attach error", e);
    return new Response(JSON.stringify({ ok: false }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
