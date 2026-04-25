// Trial lifecycle scheduler — runs hourly via pg_cron.
// Detects trial day milestones (0/3/7/10/14) and sends emails via Resend.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = "GlowSuite <onboarding@email.glowsuite.nl>";
const REPLY_TO = "support@email.glowsuite.nl";
const APP_URL = "https://glowsuite.nl";

interface Sub {
  id: string;
  user_id: string;
  plan_slug: string;
  status: string;
  trial_started_at: string;
  trial_ends_at: string;
  welcome_sent_at: string | null;
  day3_sent_at: string | null;
  day7_sent_at: string | null;
  day10_sent_at: string | null;
  day14_sent_at: string | null;
}

const styleBase = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px;`;
const btn = `display:inline-block;background:linear-gradient(135deg,#d4a574 0%,#b8895c 100%);color:#fff !important;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;margin:16px 0;`;

function tpl(title: string, body: string, ctaLabel?: string, ctaUrl?: string) {
  return `<div style="${styleBase}">
    <div style="font-size:22px;font-weight:700;margin-bottom:8px;background:linear-gradient(135deg,#d4a574,#b8895c);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">GlowSuite</div>
    <h1 style="font-size:24px;margin:24px 0 12px;color:#1a1a1a;">${title}</h1>
    <div style="font-size:16px;color:#444;">${body}</div>
    ${ctaLabel && ctaUrl ? `<a href="${ctaUrl}" style="${btn}">${ctaLabel}</a>` : ""}
    <hr style="border:none;border-top:1px solid #eee;margin:32px 0 16px;">
    <p style="font-size:12px;color:#999;">GlowSuite — Salonsoftware die met je meegroeit.<br/>${APP_URL}</p>
  </div>`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": RESEND_API_KEY,
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html, reply_to: REPLY_TO }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Email send failed for ${to}:`, res.status, text);
    return false;
  }
  return true;
}

const templates = {
  welcome: (salon: string, trialEnd: string) => ({
    subject: "Welkom bij GlowSuite — je proefperiode is gestart 🎉",
    html: tpl(
      `Welkom${salon ? `, ${salon}` : ""}!`,
      `<p>Je 14-daagse gratis proefperiode loopt tot <strong>${fmtDate(trialEnd)}</strong>.</p>
       <p>In de komende dagen helpen we je je salon volledig live te zetten. Geen betaalkaart nodig — gewoon ontdekken.</p>
       <p><strong>Eerste stap:</strong> zet je online boekingen live, want salons met online boeken krijgen tot 40% meer afspraken.</p>`,
      "Open mijn dashboard",
      `${APP_URL}/dashboard`,
    ),
  }),
  day3: (salon: string) => ({
    subject: "Heb je online boekingen al live gezet?",
    html: tpl(
      "Online boekingen — al actief?",
      `<p>Hi${salon ? ` ${salon}` : ""}, snelle vraag: heb je je boekingslink al gedeeld met klanten?</p>
       <p>Salons die online boekingen aanzetten in de eerste week zien gemiddeld <strong>3x meer afspraken</strong> dan salons die wachten.</p>
       <p>Het kost je 2 minuten om de link te kopiëren en op je Instagram, website of WhatsApp-status te zetten.</p>`,
      "Bekijk mijn boekingslink",
      `${APP_URL}/dashboard`,
    ),
  }),
  day7: () => ({
    subject: "Hoe salons hun afspraken verdubbelen met GlowSuite",
    html: tpl(
      "Meer afspraken zonder extra werk",
      `<p>Een gemiddelde GlowSuite-salon ziet:</p>
       <ul>
         <li>📈 <strong>+38%</strong> nieuwe boekingen via online widget</li>
         <li>💬 <strong>-65%</strong> no-shows door automatische WhatsApp herinneringen</li>
         <li>💳 <strong>+22%</strong> omzet via aanbetalingen vooraf</li>
       </ul>
       <p>Heb je deze functies al ontdekt?</p>`,
      "Ja, laat me zien",
      `${APP_URL}/automatiseringen`,
    ),
  }),
  day10: (trialEnd: string) => ({
    subject: "Nog 4 dagen gratis — activeer je abonnement",
    html: tpl(
      "Nog 4 dagen over",
      `<p>Je proefperiode eindigt op <strong>${fmtDate(trialEnd)}</strong>.</p>
       <p>Activeer nu je abonnement om zonder onderbreking door te werken. Je houdt al je gegevens, klanten en agenda — alles blijft staan.</p>
       <p>Plannen vanaf <strong>€39 per maand</strong>. Maandelijks opzegbaar.</p>`,
      "Activeer mijn abonnement",
      `${APP_URL}/pricing`,
    ),
  }),
  day14: () => ({
    subject: "Je proefperiode is verlopen",
    html: tpl(
      "Tijd om door te gaan",
      `<p>Je 14-daagse proefperiode is verlopen. Je account staat in alleen-lezen modus — je gegevens zijn veilig en wachten op je.</p>
       <p>Activeer een abonnement om weer volledig aan de slag te gaan:</p>
       <ul>
         <li><strong>Starter</strong> — €39 / maand</li>
         <li><strong>Growth</strong> — €79 / maand (meest gekozen)</li>
         <li><strong>Premium</strong> — op aanvraag</li>
       </ul>`,
      "Kies mijn plan",
      `${APP_URL}/pricing`,
    ),
  }),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = new Date();
  const stats = { welcome: 0, day3: 0, day7: 0, day10: 0, day14: 0, errors: 0 };

  const { data: subs, error } = await supabase
    .from("subscriptions")
    .select("*")
    .in("status", ["trialing"]);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  for (const sub of (subs ?? []) as Sub[]) {
    try {
      const startedMs = new Date(sub.trial_started_at).getTime();
      const elapsedDays = Math.floor((now.getTime() - startedMs) / 86400000);
      const endsMs = new Date(sub.trial_ends_at).getTime();
      const expired = endsMs <= now.getTime();

      // Lookup user email + salon name
      const { data: userResp } = await supabase.auth.admin.getUserById(sub.user_id);
      const email = userResp?.user?.email;
      if (!email) continue;
      const { data: profile } = await supabase
        .from("profiles")
        .select("salon_name")
        .eq("user_id", sub.user_id)
        .maybeSingle();
      const salon = profile?.salon_name ?? "";

      const sendAndMark = async (col: string, t: { subject: string; html: string }) => {
        const ok = await sendEmail(email, t.subject, t.html);
        if (ok) {
          await supabase.from("subscriptions").update({ [col]: now.toISOString() }).eq("id", sub.id);
          return true;
        }
        return false;
      };

      // Day 0 — welcome (immediately after creation)
      if (!sub.welcome_sent_at) {
        if (await sendAndMark("welcome_sent_at", templates.welcome(salon, sub.trial_ends_at))) stats.welcome++;
      }
      // Day 3
      if (elapsedDays >= 3 && !sub.day3_sent_at) {
        if (await sendAndMark("day3_sent_at", templates.day3(salon))) stats.day3++;
      }
      // Day 7
      if (elapsedDays >= 7 && !sub.day7_sent_at) {
        if (await sendAndMark("day7_sent_at", templates.day7())) stats.day7++;
      }
      // Day 10
      if (elapsedDays >= 10 && !sub.day10_sent_at) {
        if (await sendAndMark("day10_sent_at", templates.day10(sub.trial_ends_at))) stats.day10++;
      }
      // Day 14 — expired
      if (expired && !sub.day14_sent_at) {
        if (await sendAndMark("day14_sent_at", templates.day14())) stats.day14++;
        await supabase.from("subscriptions").update({ status: "expired" }).eq("id", sub.id);
      }
    } catch (e) {
      console.error("Sub processing failed:", sub.id, e);
      stats.errors++;
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: subs?.length ?? 0, stats }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
