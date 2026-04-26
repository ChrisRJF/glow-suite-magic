// Public analytics ingestion. Anonymous + authenticated.
// Stores rows in public.analytics_events.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_EVENTS = new Set([
  "landing_visit",
  "signup_started",
  "signup_completed",
  "trial_started",
  "paid_conversion",
  "referral_sent",
  "referral_signup",
  "review_submitted",
  "review_prompt_shown",
  "review_prompt_dismissed",
  "testimonial_submitted",
  "google_review_clicked",
  "checkout_started",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const event_name = String(body?.event_name || "").slice(0, 80);
    if (!event_name || !ALLOWED_EVENTS.has(event_name)) {
      return new Response(JSON.stringify({ ok: false, error: "invalid_event" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const properties =
      body?.properties && typeof body.properties === "object" ? body.properties : {};
    const session_id = body?.session_id ? String(body.session_id).slice(0, 64) : null;
    const url = body?.url ? String(body.url).slice(0, 500) : null;
    const referrer = body?.referrer ? String(body.referrer).slice(0, 500) : null;
    const user_agent = req.headers.get("user-agent")?.slice(0, 500) ?? null;

    // Resolve user from JWT if present
    let user_id: string | null = null;
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data } = await userClient.auth.getUser();
        user_id = data?.user?.id ?? null;
      } catch (_e) {
        // ignore
      }
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    await admin.from("analytics_events").insert({
      event_name,
      user_id,
      session_id,
      properties,
      url,
      referrer,
      user_agent,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("track-event error", e);
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
