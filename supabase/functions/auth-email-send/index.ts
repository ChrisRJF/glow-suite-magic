// Supabase Auth "Send Email" hook → branded GlowSuite emails via Resend
// Configure in Supabase dashboard: Authentication → Hooks → Send Email Hook
// URL: https://<project-ref>.supabase.co/functions/v1/auth-email-send
// Secret: store as SUPABASE_AUTH_HOOK_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature",
};

const FROM = "GlowSuite <onboarding@email.glowsuite.nl>";
const REPLY_TO = "support@email.glowsuite.nl";

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

function shell(opts: {
  title: string;
  preheader: string;
  intro: string;
  ctaLabel: string;
  ctaUrl: string;
  helper?: string;
  outro?: string;
}): string {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${opts.title}</title></head>
<body style="margin:0;padding:0;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f2;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;box-shadow:0 4px 24px rgba(15,23,42,0.06);overflow:hidden;">
  <tr><td style="padding:32px 32px 0 32px;">
    <div style="font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#0f172a;">GlowSuite</div>
  </td></tr>
  <tr><td style="padding:24px 32px 8px 32px;">
    <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:#0f172a;">${opts.title}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#475569;">${opts.intro}</p>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" style="border-radius:12px;background:#0f172a;">
      <a href="${opts.ctaUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${opts.ctaLabel}</a>
    </td></tr></table>
    ${opts.helper ? `<p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#94a3b8;">${opts.helper}</p>` : ""}
    ${opts.outro ? `<p style="margin:20px 0 0;font-size:14px;line-height:1.6;color:#475569;">${opts.outro}</p>` : ""}
    <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#94a3b8;word-break:break-all;">Werkt de knop niet? Kopieer deze link:<br/><a href="${opts.ctaUrl}" style="color:#475569;">${opts.ctaUrl}</a></p>
  </td></tr>
  <tr><td style="padding:32px;border-top:1px solid #f1f5f9;">
    <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">GlowSuite — software voor moderne salons.<br/>Vragen? Mail <a href="mailto:support@email.glowsuite.nl" style="color:#475569;">support@email.glowsuite.nl</a></p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

function buildEmail(payload: AuthEmailPayload): { subject: string; html: string } | null {
  const { email_data } = payload;
  const siteBase = (email_data.site_url || "https://glowsuite.nl").replace(/\/$/, "");
  // IMPORTANT: /auth/v1/verify lives on the Supabase project, NOT on the frontend.
  // Using site_url here would 404 on the SPA (or worse: hit a route with no apikey).
  const supabaseBase = SUPABASE_URL.replace(/\/$/, "");
  const redirectTo = email_data.redirect_to || siteBase;
  const verifyUrl = `${supabaseBase}/auth/v1/verify?token=${email_data.token_hash}&type=${email_data.email_action_type}&redirect_to=${encodeURIComponent(redirectTo)}`;

  switch (email_data.email_action_type) {
    case "signup":
      return {
        subject: "Bevestig je GlowSuite account",
        html: shell({
          title: "Welkom bij GlowSuite",
          preheader: "Bevestig je e-mailadres en start je 14 dagen gratis proef.",
          intro:
            "Leuk dat je GlowSuite uitprobeert! Bevestig je e-mailadres om je account te activeren en je 14 dagen gratis proefperiode te starten.",
          ctaLabel: "Bevestig e-mailadres",
          ctaUrl: verifyUrl,
          helper:
            "✓ 14 dagen gratis &nbsp;·&nbsp; ✓ Geen creditcard nodig &nbsp;·&nbsp; ✓ Maandelijks opzegbaar",
          outro:
            "Daarna helpen we je in 5 minuten je salon live zetten — diensten, team en online boekingen.",
        }),
      };
    case "magiclink":
      return {
        subject: "Je GlowSuite inloglink",
        html: shell({
          title: "Log in bij GlowSuite",
          preheader: "Klik om direct in te loggen op je salon.",
          intro: "Klik op de knop hieronder om in te loggen. Deze link is 1 uur geldig.",
          ctaLabel: "Inloggen",
          ctaUrl: verifyUrl,
          helper: "Heb je deze link niet aangevraagd? Negeer dan deze e-mail.",
        }),
      };
    case "recovery":
      return {
        subject: "Reset je GlowSuite wachtwoord",
        html: shell({
          title: "Wachtwoord herstellen",
          preheader: "Stel een nieuw wachtwoord in voor je GlowSuite account.",
          intro:
            "Je hebt een wachtwoord-reset aangevraagd. Klik op de knop om een nieuw wachtwoord in te stellen. Deze link is 1 uur geldig.",
          ctaLabel: "Nieuw wachtwoord instellen",
          ctaUrl: verifyUrl,
          helper: "Heb je dit niet aangevraagd? Negeer deze e-mail — je wachtwoord blijft ongewijzigd.",
        }),
      };
    case "invite":
      return {
        subject: "Je bent uitgenodigd voor GlowSuite",
        html: shell({
          title: "Je bent uitgenodigd",
          preheader: "Accepteer je uitnodiging voor GlowSuite.",
          intro: "Je bent uitgenodigd om mee te werken in een GlowSuite salon. Accepteer je uitnodiging om te starten.",
          ctaLabel: "Uitnodiging accepteren",
          ctaUrl: verifyUrl,
        }),
      };
    case "email_change":
    case "email_change_new":
    case "email_change_current":
      return {
        subject: "Bevestig je nieuwe e-mailadres",
        html: shell({
          title: "Bevestig je nieuwe e-mailadres",
          preheader: "Bevestig de wijziging van je e-mailadres.",
          intro: "Bevestig de wijziging van je e-mailadres bij GlowSuite door op de knop hieronder te klikken.",
          ctaLabel: "E-mailadres bevestigen",
          ctaUrl: verifyUrl,
        }),
      };
    case "reauthentication":
      return {
        subject: `Je GlowSuite verificatiecode: ${email_data.token}`,
        html: shell({
          title: "Verificatiecode",
          preheader: "Gebruik deze code om door te gaan.",
          intro: `Je verificatiecode is: <strong style="font-size:20px;letter-spacing:2px;">${email_data.token}</strong>`,
          ctaLabel: "Open GlowSuite",
          ctaUrl: base,
          helper: "Deel deze code nooit met anderen.",
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
