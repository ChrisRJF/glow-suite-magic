// Day 0 welcome email — branded, idempotent (only sends once per user)
// Trigger from client after first successful login, or from any backend event

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FROM = "GlowSuite <onboarding@email.glowsuite.nl>";
const REPLY_TO = "support@email.glowsuite.nl";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function welcomeHtml(name: string, trialEnd: string, dashboardUrl: string): string {
  const greet = name ? `Hoi ${name},` : "Welkom!";
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>Welkom bij GlowSuite</title></head>
<body style="margin:0;padding:0;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Je proefperiode is gestart — laten we je salon live zetten.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f2;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;box-shadow:0 4px 24px rgba(15,23,42,0.06);overflow:hidden;">
  <tr><td style="padding:32px 32px 0;font-size:20px;font-weight:700;letter-spacing:-0.02em;">GlowSuite</td></tr>
  <tr><td style="padding:24px 32px 8px;">
    <h1 style="margin:0 0 12px;font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;">Welkom bij GlowSuite ✨</h1>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#475569;">${greet}</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#475569;">
      Je proefperiode is gestart en loopt tot <strong>${trialEnd}</strong>. Geen creditcard nodig.
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#475569;">
      Zet je salon binnen 5 minuten live — de korte installatie wacht op je in het dashboard.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" style="border-radius:12px;background:#0f172a;">
      <a href="${dashboardUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">Open mijn dashboard</a>
    </td></tr></table>
    <div style="margin:32px 0 0;padding:20px;background:#f8fafc;border-radius:14px;">
      <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#0f172a;">Wat je in 5 minuten doet:</p>
      <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#475569;">1. Salongegevens & logo</p>
      <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#475569;">2. Diensten en prijzen</p>
      <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#475569;">3. Team en werktijden</p>
      <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#475569;">4. Online boekingen aanzetten</p>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#475569;">5. Betalingen activeren (optioneel)</p>
    </div>
  </td></tr>
  <tr><td style="padding:32px;border-top:1px solid #f1f5f9;">
    <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">Vragen? Mail <a href="mailto:support@email.glowsuite.nl" style="color:#475569;">support@email.glowsuite.nl</a><br/>GlowSuite — software voor moderne salons.</p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Authenticate caller
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user?.email) {
      return new Response(JSON.stringify({ error: "no_user" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency — has welcome email already been sent?
    const { data: existing } = await admin
      .from("audit_logs")
      .select("id")
      .eq("event_type", "welcome_email_sent")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ skipped: "already_sent" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get trial end + name
    const { data: sub } = await admin
      .from("subscriptions")
      .select("trial_ends_at")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, salon_name")
      .eq("user_id", user.id)
      .maybeSingle();

    const trialEnd = sub?.trial_ends_at
      ? new Date(sub.trial_ends_at).toLocaleDateString("nl-NL", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : new Date(Date.now() + 14 * 86400000).toLocaleDateString("nl-NL", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });

    const name = (profile?.full_name as string) || "";
    const dashboardUrl = "https://glowsuite.nl/";

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [user.email],
        reply_to: REPLY_TO,
        subject: "Welkom bij GlowSuite — je proefperiode is gestart",
        html: welcomeHtml(name, trialEnd, dashboardUrl),
        tags: [{ name: "category", value: "welcome_day0" }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      await admin.from("audit_logs").insert({
        user_id: user.id,
        event_type: "welcome_email_failed",
        metadata: { status: res.status, error: errText },
      });
      return new Response(JSON.stringify({ error: "send_failed" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("audit_logs").insert({
      user_id: user.id,
      event_type: "welcome_email_sent",
      metadata: { email: user.email },
    });

    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
