// Supabase Auth "Send Email" hook → branded GlowSuite emails via Resend
// Configure in Supabase dashboard: Authentication → Hooks → Send Email Hook
// URL: https://<project-ref>.supabase.co/functions/v1/auth-email-send
// Secret: store as SUPABASE_AUTH_HOOK_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import {
  renderGlowSuiteEmail,
  GLOWSUITE_FROM,
  GLOWSUITE_REPLY_TO,
} from "../_shared/glowsuiteEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature",
};

const FROM = GLOWSUITE_FROM;
const REPLY_TO = GLOWSUITE_REPLY_TO;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const HOOK_SECRET = Deno.env.get("AUTH_HOOK_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface AuthEmailPayload {
  user: { email: string; id?: string };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type:
      | "signup"
      | "magiclink"
      | "recovery"
      | "invite"
      | "email_change"
      | "email_change_current"
      | "email_change_new"
      | "reauthentication";
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

function buildEmail(payload: AuthEmailPayload): { subject: string; html: string } | null {
  const { email_data } = payload;
  const siteBase = (email_data.site_url || "https://glowsuite.nl").replace(/\/$/, "");
  // IMPORTANT: /auth/v1/verify lives on the Supabase project, NOT on the frontend.
  const supabaseBase = SUPABASE_URL.replace(/\/$/, "");
  const redirectTo = email_data.redirect_to || siteBase;
  const verifyUrl = `${supabaseBase}/auth/v1/verify?token=${email_data.token_hash}&type=${email_data.email_action_type}&redirect_to=${encodeURIComponent(redirectTo)}`;

  switch (email_data.email_action_type) {
    case "signup":
      return {
        subject: "Bevestig je GlowSuite account",
        html: renderGlowSuiteEmail({
          title: "Welkom bij GlowSuite",
          preheader: "Bevestig je e-mailadres en start je proefperiode.",
          eyebrow: "Welkom",
          heading: "Welkom bij GlowSuite",
          intro:
            "Leuk dat je GlowSuite uitprobeert. Bevestig je e-mailadres om je account te activeren en je proefperiode te starten.",
          ctaLabel: "Bevestig e-mailadres",
          ctaUrl: verifyUrl,
          helper: "14 dagen gratis · Geen creditcard nodig · Maandelijks opzegbaar",
          outro:
            "Daarna helpen we je in 5 minuten je salon live te zetten — diensten, team en online boekingen.",
        }),
      };
    case "magiclink":
      return {
        subject: "Je GlowSuite inloglink",
        html: renderGlowSuiteEmail({
          title: "Log in bij GlowSuite",
          preheader: "Klik om direct in te loggen.",
          eyebrow: "Inloglink",
          heading: "Log veilig in bij GlowSuite",
          intro: "Klik op de knop hieronder om in te loggen. Deze link is 1 uur geldig.",
          ctaLabel: "Inloggen",
          ctaUrl: verifyUrl,
          helper: "Heb je deze link niet aangevraagd? Negeer dan deze e-mail.",
        }),
      };
    case "recovery":
      return {
        subject: "Stel veilig een nieuw wachtwoord in",
        html: renderGlowSuiteEmail({
          title: "Wachtwoord herstellen",
          preheader: "Stel veilig een nieuw wachtwoord in voor GlowSuite.",
          eyebrow: "Beveiliging",
          heading: "Stel veilig een nieuw wachtwoord in",
          intro:
            "Je vroeg een wachtwoord-reset aan. Klik op de knop om een nieuw wachtwoord in te stellen. Deze link is 1 uur geldig.",
          ctaLabel: "Nieuw wachtwoord instellen",
          ctaUrl: verifyUrl,
          helper:
            "Heb je dit niet aangevraagd? Negeer deze e-mail — je wachtwoord blijft ongewijzigd.",
          footerReason: "security",
        }),
      };
    case "invite":
      return {
        subject: "Je bent uitgenodigd voor GlowSuite",
        html: renderGlowSuiteEmail({
          title: "Je bent uitgenodigd",
          preheader: "Accepteer je uitnodiging voor GlowSuite.",
          eyebrow: "Uitnodiging",
          heading: "Je bent uitgenodigd",
          intro:
            "Je bent uitgenodigd om mee te werken in een GlowSuite salon. Accepteer je uitnodiging om te starten.",
          ctaLabel: "Uitnodiging accepteren",
          ctaUrl: verifyUrl,
        }),
      };
    case "email_change":
    case "email_change_new":
    case "email_change_current":
      return {
        subject: "Bevestig je nieuwe e-mailadres",
        html: renderGlowSuiteEmail({
          title: "Bevestig je nieuwe e-mailadres",
          preheader: "Bevestig de wijziging van je e-mailadres.",
          eyebrow: "Account",
          heading: "Bevestig je nieuwe e-mailadres",
          intro:
            "Bevestig de wijziging van je e-mailadres bij GlowSuite door op de knop hieronder te klikken.",
          ctaLabel: "E-mailadres bevestigen",
          ctaUrl: verifyUrl,
        }),
      };
    case "reauthentication":
      return {
        subject: `Je GlowSuite verificatiecode: ${email_data.token}`,
        html: renderGlowSuiteEmail({
          title: "Verificatiecode",
          preheader: "Gebruik deze code om door te gaan.",
          eyebrow: "Verificatie",
          heading: "Je verificatiecode",
          intro: "Gebruik onderstaande code om door te gaan in GlowSuite. De code is 10 minuten geldig.",
          bodyHtml: `<div style="margin:18px 0 6px;padding:22px;background:#f6f4ff;border:1px solid #ece6ff;border-radius:14px;text-align:center;">
            <div style="font-family:'SF Mono','Menlo','Roboto Mono',monospace;font-size:30px;letter-spacing:8px;font-weight:600;color:#0f172a;">${String(email_data.token).replace(/[^0-9A-Za-z]/g, "")}</div>
          </div>`,
          helper: "Deel deze code nooit met anderen.",
          footerReason: "security",
        }),
      };
    default:
      return null;
  }
}

async function logAudit(event: string, data: Record<string, unknown>) {
  try {
    await admin.from("audit_logs").insert({
      event_type: event,
      metadata: data,
    });
  } catch (_) {
    // swallow — never break auth
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const raw = await req.text();
  let payload: AuthEmailPayload;

  try {
    if (HOOK_SECRET) {
      const wh = new Webhook(HOOK_SECRET.replace(/^v1,whsec_/, ""));
      const headers = {
        "webhook-id": req.headers.get("webhook-id") ?? "",
        "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
        "webhook-signature": req.headers.get("webhook-signature") ?? "",
      };
      payload = wh.verify(raw, headers) as AuthEmailPayload;
    } else {
      payload = JSON.parse(raw) as AuthEmailPayload;
    }
  } catch (e) {
    await logAudit("auth_email_signature_failed", { error: String(e) });
    // Returning 200 with empty so Supabase falls back to default email
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const built = buildEmail(payload);
  if (!built) {
    await logAudit("auth_email_skipped", { type: payload.email_data?.email_action_type });
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [payload.user.email],
        reply_to: REPLY_TO,
        subject: built.subject,
        html: built.html,
        tags: [{ name: "category", value: `auth_${payload.email_data.email_action_type}` }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      await logAudit("auth_email_send_failed", {
        type: payload.email_data.email_action_type,
        email: payload.user.email,
        status: res.status,
        error: errText,
      });
      // Tell Supabase to fallback by signaling error — but 200 with empty body is safer
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await logAudit("auth_email_sent", {
      type: payload.email_data.email_action_type,
      email: payload.user.email,
    });
  } catch (e) {
    await logAudit("auth_email_exception", { error: String(e) });
  }

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
