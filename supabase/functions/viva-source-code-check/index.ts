import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function mask(v: string | undefined | null) {
  if (!v) return null;
  const s = String(v);
  return {
    length: s.length,
    last4: s.length >= 4 ? s.slice(-4) : s,
    is_placeholder_1234: s.trim() === "1234",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "eigenaar" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sc = Deno.env.get("VIVA_SOURCE_CODE");
    const pos = Deno.env.get("VIVA_POS_SOURCE_CODE");
    const scInfo = mask(sc);
    const posInfo = mask(pos);

    return new Response(JSON.stringify({
      VIVA_SOURCE_CODE: scInfo,
      VIVA_POS_SOURCE_CODE: posInfo,
      same_value: !!sc && !!pos && sc === pos,
      smart_checkout_uses_placeholder_1234: scInfo?.is_placeholder_1234 === true,
      pos_uses_placeholder_1234: posInfo?.is_placeholder_1234 === true,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
