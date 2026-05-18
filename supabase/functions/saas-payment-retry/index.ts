// Daily cron — handles past_due SaaS subscriptions.
// 1. past_due >= 0d, no failure email yet → send "payment failed" email
// 2. past_due >= 3d, no retry yet → trigger one Mollie payment with existing mandate
// 3. past_due >= 7d → frontend treats as read-only
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  renderGlowSuiteEmail,
  GLOWSUITE_FROM,
  GLOWSUITE_REPLY_TO,
  GLOWSUITE_APP_URL,
} from "../_shared/glowsuiteEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = GLOWSUITE_FROM;
const REPLY_TO = GLOWSUITE_REPLY_TO;
const APP_URL = GLOWSUITE_APP_URL;
const MOLLIE_API = "https://api.mollie.com/v2";

function getMollieKey(): string {
  return (
    Deno.env.get("MOLLIE_LIVE_API_KEY") ||
    Deno.env.get("MOLLIE_TEST_API_KEY") ||
    ""
  );
}

async function mollie(path: string, method: string, body?: unknown) {
  const key = getMollieKey();
  const res = await fetch(`${MOLLIE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Mollie ${method} ${path} [${res.status}]: ${JSON.stringify(json)}`);
  }
  return json;
}

function failedEmailHtml(salon: string, manageUrl: string) {
  return renderGlowSuiteEmail({
    title: "Je betaling is niet gelukt",
    preheader: "We proberen het over 3 dagen automatisch opnieuw.",
    eyebrow: "Betaling",
    heading: "Je betaling is niet gelukt",
    intro: `${salon ? `Hi ${salon}, h` : "H"}elaas kon de automatische incasso voor je GlowSuite abonnement niet worden afgeschreven. Mogelijk is er onvoldoende saldo, is je kaart verlopen, of heeft je bank de betaling geweigerd.\n\nWat nu? We proberen het over 3 dagen automatisch nog één keer. Je kunt ook nu zelf je betaalmethode bijwerken.`,
    ctaLabel: "Beheer mijn abonnement",
    ctaUrl: manageUrl,
    helper:
      "Lukt het binnen 7 dagen niet om de betaling te herstellen? Dan zetten we je account tijdelijk in alleen-lezen modus tot de betaling weer rond is. Je gegevens blijven natuurlijk veilig staan.",
    footerReason: "billing",
  });
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
    console.error("Resend env not configured");
    return false;
  }
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
    console.error(`Resend send failed for ${to}:`, res.status, text);
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const stats = { processed: 0, emails_sent: 0, retries_triggered: 0, errors: 0 };

  const { data: subs, error } = await admin
    .from("subscriptions")
    .select("*")
    .eq("status", "past_due");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const now = Date.now();
  const DAY = 86400000;

  for (const sub of (subs ?? []) as any[]) {
    stats.processed++;
    try {
      // Bootstrap past_due_since if missing (legacy rows)
      if (!sub.past_due_since) {
        await admin
          .from("subscriptions")
          .update({ past_due_since: new Date().toISOString() })
          .eq("id", sub.id);
        sub.past_due_since = new Date().toISOString();
      }

      const dueAgeDays = (now - new Date(sub.past_due_since).getTime()) / DAY;

      // Fetch user email + salon name
      const { data: userResp } = await admin.auth.admin.getUserById(sub.user_id);
      const email = userResp?.user?.email;
      const { data: profile } = await admin
        .from("profiles")
        .select("salon_name")
        .eq("user_id", sub.user_id)
        .maybeSingle();
      const salon = profile?.salon_name ?? "";

      // Step 1: send failure email if not yet sent
      if (email && !sub.payment_failure_email_sent_at) {
        const ok = await sendEmail(
          email,
          "Je GlowSuite betaling is niet gelukt",
          failedEmailHtml(salon, `${APP_URL}/mijn-abonnement`),
        );
        if (ok) {
          stats.emails_sent++;
          await admin
            .from("subscriptions")
            .update({ payment_failure_email_sent_at: new Date().toISOString() })
            .eq("id", sub.id);
        }
      }

      // Step 2: trigger ONE retry after 3 days
      if (
        dueAgeDays >= 3 &&
        !sub.retry_attempted_at &&
        sub.mollie_customer_id &&
        sub.mollie_mandate_id
      ) {
        const { data: plan } = await admin
          .from("subscription_plans")
          .select("*")
          .eq("slug", sub.plan_slug)
          .maybeSingle();
        if (plan) {
          try {
            await mollie(
              `/customers/${sub.mollie_customer_id}/payments`,
              "POST",
              {
                amount: {
                  currency: plan.currency,
                  value: Number(plan.price_eur).toFixed(2),
                },
                description: `GlowSuite ${plan.name} — herstelpoging`,
                sequenceType: "recurring",
                mandateId: sub.mollie_mandate_id,
                webhookUrl: `${SUPABASE_URL}/functions/v1/saas-subscribe-webhook-recurring`,
                metadata: {
                  user_id: sub.user_id,
                  plan_slug: sub.plan_slug,
                  kind: "saas_retry",
                },
              },
            );
            stats.retries_triggered++;
            await admin
              .from("subscriptions")
              .update({ retry_attempted_at: new Date().toISOString() })
              .eq("id", sub.id);
            await admin.from("audit_logs").insert({
              user_id: sub.user_id,
              actor_user_id: null,
              action: "saas_payment_retry_triggered",
              target_type: "saas_subscription",
              target_id: sub.id,
              details: { age_days: Math.floor(dueAgeDays) },
              is_demo: false,
            });
          } catch (e) {
            console.error("retry payment failed", sub.id, e);
            stats.errors++;
          }
        }
      }
    } catch (e) {
      console.error("past_due processing failed", sub.id, e);
      stats.errors++;
    }
  }

  return new Response(JSON.stringify({ ok: true, stats }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
