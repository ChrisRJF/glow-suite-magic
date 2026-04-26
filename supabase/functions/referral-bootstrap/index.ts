// Ensures the current authenticated user has a referral code.
// Returns { code, total_referred, total_converted, total_credit_months,
//           credit_months_balance, referrals: [...] }.
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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Ensure code exists via SECURITY DEFINER fn
    const { data: codeData, error: codeErr } = await admin.rpc(
      "ensure_referral_code",
      { _user_id: userId },
    );
    if (codeErr) throw codeErr;
    const code = codeData as string;

    const [{ data: row }, { data: refs }, { data: sub }] = await Promise.all([
      admin
        .from("referral_codes")
        .select("code,total_referred,total_converted,total_credit_months")
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("referrals")
        .select("id,code,status,credit_months,signed_up_at,converted_at,credited_at")
        .eq("referrer_user_id", userId)
        .order("signed_up_at", { ascending: false })
        .limit(50),
      admin
        .from("subscriptions")
        .select("credit_months_balance")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    return new Response(
      JSON.stringify({
        code: row?.code ?? code,
        total_referred: row?.total_referred ?? 0,
        total_converted: row?.total_converted ?? 0,
        total_credit_months: row?.total_credit_months ?? 0,
        credit_months_balance: sub?.credit_months_balance ?? 0,
        referrals: refs ?? [],
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("referral-bootstrap error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
