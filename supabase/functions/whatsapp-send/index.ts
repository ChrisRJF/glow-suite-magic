import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  // Default to NL if no country code
  if (digits.startsWith("0")) return "+31" + digits.substring(1);
  return "+" + digits;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    if (!TWILIO_API_KEY) throw new Error("TWILIO_API_KEY not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json();
    const {
      user_id,
      to,
      message,
      customer_id = null,
      appointment_id = null,
      kind = "manual",
      test = false,
      meta = {},
    } = body;

    if (!user_id || !to || !message) {
      return new Response(JSON.stringify({ error: "user_id, to, message required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load settings
    const { data: settings } = await admin
      .from("whatsapp_settings")
      .select("*")
      .eq("user_id", user_id)
      .maybeSingle();

    if (!test && (!settings || !settings.enabled)) {
      return new Response(JSON.stringify({ error: "WhatsApp niet ingeschakeld" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fromNumber = settings?.from_number || "whatsapp:+14155238886";
    const normalizedTo = normalizePhone(to);
    if (!normalizedTo) {
      return new Response(JSON.stringify({ error: "Ongeldig telefoonnummer" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const waTo = `whatsapp:${normalizedTo}`;

    // Send via Twilio gateway
    const twResp = await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TWILIO_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: waTo,
        From: fromNumber.startsWith("whatsapp:") ? fromNumber : `whatsapp:${fromNumber}`,
        Body: message,
      }),
    });

    const twData = await twResp.json();
    const ok = twResp.ok;

    const { error: logErr } = await admin.from("whatsapp_logs").insert({
      user_id,
      customer_id,
      appointment_id,
      to_number: waTo,
      message,
      status: ok ? "sent" : "failed",
      twilio_sid: twData?.sid ?? null,
      error: ok ? null : (twData?.message || JSON.stringify(twData)).slice(0, 500),
      kind,
      meta,
    });

    // Race-safe dedup: unique index on (appointment_id, kind) WHERE status='sent'
    // If another worker already logged a successful send, treat this as a duplicate.
    if (logErr && (logErr.code === "23505" || /duplicate key/i.test(logErr.message))) {
      return new Response(
        JSON.stringify({ success: true, deduped: true, sid: twData?.sid ?? null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!ok) {
      return new Response(
        JSON.stringify({ success: false, error: twData?.message || "Twilio fout", details: twData }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ success: true, sid: twData.sid }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("whatsapp-send error", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
