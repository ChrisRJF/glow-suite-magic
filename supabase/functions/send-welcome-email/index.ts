// Day 0 welcome email — branded, idempotent (only sends once per user)
// Trigger from client after first successful login, or from any backend event

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  renderGlowSuiteEmail,
  bulletListHtml,
  GLOWSUITE_FROM,
  GLOWSUITE_REPLY_TO,
} from "../_shared/glowsuiteEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FROM = GLOWSUITE_FROM;
const REPLY_TO = GLOWSUITE_REPLY_TO;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function welcomeHtml(name: string, trialEnd: string, dashboardUrl: string): string {
  return renderGlowSuiteEmail({
    title: "Welkom bij GlowSuite",
    preheader: "Je proefperiode is gestart — zet je salon binnen 5 minuten live.",
    eyebrow: "Proefperiode gestart",
    heading: name ? `Welkom bij GlowSuite, ${name}` : "Welkom bij GlowSuite",
    intro: `Je proefperiode is gestart en loopt tot ${trialEnd}. Geen creditcard nodig.\n\nZet je salon binnen 5 minuten live — de korte installatie wacht op je in het dashboard.`,
    ctaLabel: "Open mijn dashboard",
    ctaUrl: dashboardUrl,
    bodyHtml: `<p style="margin:24px 0 8px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#0f172a;" class="gs-heading">Wat je in 5 minuten doet</p>${bulletListHtml([
      "Salongegevens & logo",
      "Diensten en prijzen",
      "Team en werktijden",
      "Online boekingen aanzetten",
      "Betalingen activeren (optioneel)",
    ])}`,
  });
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
