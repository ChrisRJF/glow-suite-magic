import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";
const DEFAULT_FROM = "whatsapp:+14155238886"; // Twilio sandbox number (central GlowSuite)

function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return "+31" + digits.substring(1);
  return "+" + digits;
}

function safeError(payload: unknown): string {
  try {
    if (!payload) return "Onbekende fout";
    if (typeof payload === "string") return payload.slice(0, 500);
    const p = payload as Record<string, unknown>;
    const parts = [
      p.message ? `${p.message}` : null,
      p.code ? `code=${p.code}` : null,
      p.more_info ? `info=${p.more_info}` : null,
    ].filter(Boolean);
    if (parts.length) return parts.join(" · ").slice(0, 500);
    return JSON.stringify(payload).slice(0, 500);
  } catch {
    return "Onbekende fout";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY niet geconfigureerd");
    if (!TWILIO_API_KEY) throw new Error("Centrale Twilio koppeling ontbreekt — neem contact op met GlowSuite support.");

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
      return new Response(JSON.stringify({ success: false, error: "user_id, to, message verplicht" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load salon settings (central Twilio is used; salon only toggles enabled + from sender preference)
    const { data: settings } = await admin
      .from("whatsapp_settings")
      .select("enabled, from_number")
      .eq("user_id", user_id)
      .maybeSingle();

    if (!test && (!settings || !settings.enabled)) {
      return new Response(JSON.stringify({ success: false, error: "WhatsApp is niet ingeschakeld voor deze salon." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // From: salon override (rare) or central GlowSuite sender
    const rawFrom = settings?.from_number || DEFAULT_FROM;
    const fromNumber = rawFrom.startsWith("whatsapp:") ? rawFrom : `whatsapp:${rawFrom}`;

    const normalizedTo = normalizePhone(to);
    if (!normalizedTo) {
      return new Response(JSON.stringify({ success: false, error: "Ongeldig telefoonnummer formaat (gebruik +31...)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const waTo = `whatsapp:${normalizedTo}`;
    const isSandbox = fromNumber === DEFAULT_FROM;

    // Send via central Twilio gateway
    const twResp = await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TWILIO_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: waTo,
        From: fromNumber,
        Body: message,
      }),
    });

    let twData: any = {};
    try { twData = await twResp.json(); } catch { twData = { raw: await twResp.text().catch(() => "") }; }
    const ok = twResp.ok && (twData?.sid || twData?.status === "queued" || twData?.status === "accepted");
    const twStatus = twData?.status || (ok ? "queued" : "failed");

    console.log("whatsapp-send result", {
      user_id,
      to: waTo,
      from: fromNumber,
      kind,
      http: twResp.status,
      twilio_status: twStatus,
      sid: twData?.sid,
      error_code: twData?.code,
      error_message: twData?.message,
      sandbox: isSandbox,
    });

    const logMeta = {
      ...meta,
      twilio_status: twStatus,
      twilio_code: twData?.code ?? null,
      twilio_more_info: twData?.more_info ?? null,
      sandbox: isSandbox,
      http_status: twResp.status,
    };

    const { error: logErr } = await admin.from("whatsapp_logs").insert({
      user_id,
      customer_id,
      appointment_id,
      to_number: waTo,
      message,
      status: ok ? "sent" : "failed",
      twilio_sid: twData?.sid ?? null,
      error: ok ? null : safeError(twData),
      kind,
      meta: logMeta,
    });

    // Race-safe dedup
    if (logErr && (logErr.code === "23505" || /duplicate key/i.test(logErr.message))) {
      return new Response(
        JSON.stringify({ success: true, deduped: true, sid: twData?.sid ?? null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Increment usage atomically (only count real sends/fails, skip pure tests if you want — we count both for transparency)
    try {
      await admin.rpc("increment_whatsapp_usage", {
        _user_id: user_id,
        _sent: ok ? 1 : 0,
        _failed: ok ? 0 : 1,
      });
    } catch (usageErr) {
      console.error("usage increment failed (non-blocking)", usageErr);
    }

    if (!ok) {
      // Detect sandbox "not joined" Twilio error 63007/63015/21608 etc.
      const code = twData?.code;
      const sandboxNotJoined = isSandbox && (code === 63007 || code === 21608 || code === 63015 ||
        /sandbox|not.*joined|not been.*verified/i.test(twData?.message || ""));
      const friendly = sandboxNotJoined
        ? "Sandbox: dit nummer heeft nog geen 'join <code>' gestuurd naar de Twilio sandbox. Vraag de ontvanger eerst de join-code te sturen."
        : (twData?.message || "Twilio kon het bericht niet versturen.");
      return new Response(
        JSON.stringify({
          success: false,
          error: friendly,
          twilio_code: code ?? null,
          twilio_status: twStatus,
          sandbox: isSandbox,
          details: twData,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({
      success: true,
      sid: twData.sid,
      twilio_status: twStatus,
      sandbox: isSandbox,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("whatsapp-send error", err);
    const msg = err instanceof Error ? err.message : "Onbekende fout";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
