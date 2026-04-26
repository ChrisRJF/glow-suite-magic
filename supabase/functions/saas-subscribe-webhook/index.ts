// Mollie webhook for SaaS subscription first payment.
// On paid: creates Mollie subscription (recurring monthly) and activates row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MOLLIE_API = "https://api.mollie.com/v2";
const FROM_EMAIL = "GlowSuite <onboarding@email.glowsuite.nl>";
const REPLY_TO = "support@email.glowsuite.nl";

function getMollieKey(): string {
  return (
    Deno.env.get("MOLLIE_LIVE_API_KEY") ||
    Deno.env.get("MOLLIE_TEST_API_KEY") ||
    ""
  );
}

function loginEmailHtml(opts: {
  planName: string;
  loginUrl: string;
  fullName?: string;
}) {
  const greeting = opts.fullName ? `Hi ${opts.fullName},` : "Welkom!";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Je GlowSuite account is klaar</title></head>
<body style="margin:0;padding:0;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="font-size:24px;font-weight:700;margin-bottom:24px;background:linear-gradient(135deg,#d4a574,#b8895c);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">GlowSuite</div>
    <div style="background:#ffffff;border-radius:16px;padding:32px 28px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
      <h1 style="font-size:22px;margin:0 0 16px;font-weight:700;line-height:1.3;">Je GlowSuite account is klaar 🎉</h1>
      <p style="font-size:16px;line-height:1.55;margin:0 0 12px;color:#444;">${greeting}</p>
      <p style="font-size:16px;line-height:1.55;margin:0 0 20px;color:#444;">Je betaling is gelukt en je <strong>${opts.planName}</strong>-abonnement is direct actief. Klik op de knop hieronder om in te loggen — geen wachtwoord nodig.</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${opts.loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#d4a574 0%,#b8895c 100%);color:#ffffff !important;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;">Log in op GlowSuite</a>
      </div>
      <p style="font-size:14px;line-height:1.55;margin:0 0 8px;color:#666;"><strong>Volgende stap:</strong> open je dashboard en zet je salon binnen 5 minuten live met de installatiewizard.</p>
      <p style="font-size:13px;line-height:1.5;margin:24px 0 0;color:#999;">Werkt de knop niet? Kopieer deze link in je browser:<br/><span style="word-break:break-all;color:#666;">${opts.loginUrl}</span></p>
    </div>
    <p style="font-size:12px;color:#999;text-align:center;margin:24px 0 0;">GlowSuite — Salonsoftware die met je meegroeit.<br/>Vragen? Antwoord op deze mail of stuur naar support@email.glowsuite.nl</p>
  </div>
</body></html>`;
}

async function sendLoginEmail(
  admin: any,
  userId: string | null,
  email: string,
  planName: string,
  loginUrl: string,
  fullName?: string,
): Promise<boolean> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
    console.error("Resend env not configured");
    await admin.from("audit_logs").insert({
      user_id: userId ?? "00000000-0000-0000-0000-000000000000",
      actor_user_id: null,
      action: "saas_login_email_failed",
      target_type: "saas_subscription",
      target_id: email,
      details: { reason: "missing_resend_env" },
      is_demo: false,
    }).then(() => {}, () => {});
    return false;
  }

  try {
    const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: "Je GlowSuite account is klaar",
        html: loginEmailHtml({ planName, loginUrl, fullName }),
        reply_to: REPLY_TO,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("Resend send failed:", res.status, text);
      await admin.from("audit_logs").insert({
        user_id: userId ?? "00000000-0000-0000-0000-000000000000",
        actor_user_id: null,
        action: "saas_login_email_failed",
        target_type: "saas_subscription",
        target_id: email,
        details: { status: res.status, body: text.slice(0, 500) },
        is_demo: false,
      }).then(() => {}, () => {});
      return false;
    }
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("Resend send threw:", msg);
    await admin.from("audit_logs").insert({
      user_id: userId ?? "00000000-0000-0000-0000-000000000000",
      actor_user_id: null,
      action: "saas_login_email_failed",
      target_type: "saas_subscription",
      target_id: email,
      details: { error: msg },
      is_demo: false,
    }).then(() => {}, () => {});
    return false;
  }
}


async function mollie(
  path: string,
  method: string,
  body?: unknown,
): Promise<any> {
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
    throw new Error(
      `Mollie ${method} ${path} [${res.status}]: ${JSON.stringify(json)}`,
    );
  }
  return json;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const form = await req.formData().catch(() => null);
    const paymentId = form?.get("id")?.toString();
    if (!paymentId) {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const payment = await mollie(`/payments/${paymentId}`, "GET");
    const meta = payment.metadata || {};
    const kind = meta.kind;
    if (kind !== "saas_first" && kind !== "saas_first_public") {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    const planSlug = meta.plan_slug as string;
    const { data: plan } = await admin
      .from("subscription_plans")
      .select("*")
      .eq("slug", planSlug)
      .maybeSingle();

    // ----- Resolve user_id (existing flow uses meta.user_id, public flow creates user from email) -----
    let userId = meta.user_id as string | undefined;

    if (kind === "saas_first_public" && payment.status === "paid") {
      const email = String(meta.email || "").toLowerCase();
      const fullName = String(meta.full_name || "").trim();
      if (email) {
        // Find existing user
        const { data: list } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        });
        const existing = list?.users?.find(
          (u: any) => (u.email || "").toLowerCase() === email,
        );
        if (existing) {
          userId = existing.id;
        } else {
          const { data: created, error: createErr } =
            await admin.auth.admin.createUser({
              email,
              email_confirm: true,
              user_metadata: {
                plan: planSlug,
                salon_name: meta.salon_name || "",
                full_name: fullName,
              },
            });
          if (createErr) {
            console.error("createUser failed", createErr);
          } else {
            userId = created?.user?.id;
          }
        }

        // Generate magic link + send branded login email (new + existing users)
        if (userId) {
          const origin =
            payment.redirectUrl?.split("/").slice(0, 3).join("/") ||
            "https://glowsuite.nl";
          let loginUrl = `${origin}/login?subscribed=1&email=${encodeURIComponent(email)}`;
          try {
            const { data: linkData, error: linkErr } =
              await admin.auth.admin.generateLink({
                type: "magiclink",
                email,
                options: { redirectTo: `${origin}/?subscribed=1` },
              });
            if (linkErr) {
              console.error("magic link gen failed", linkErr);
            } else if (linkData?.properties?.action_link) {
              loginUrl = linkData.properties.action_link;
            }
          } catch (e) {
            console.error("magic link gen threw", e);
          }
          await sendLoginEmail(
            admin,
            userId,
            email,
            plan?.name || planSlug,
            loginUrl,
            fullName || undefined,
          );
        }
      }
    }

    if (!userId) {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    // ----- Find / create subscription row -----
    const { data: subRow } = await admin
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (payment.status === "paid" && payment.customerId && payment.mandateId) {
      // Create recurring subscription with Mollie
      const subscription = await mollie(
        `/customers/${payment.customerId}/subscriptions`,
        "POST",
        {
          amount: {
            currency: plan?.currency || "EUR",
            value: Number(plan?.price_eur || 0).toFixed(2),
          },
          interval: "1 month",
          description: `GlowSuite ${plan?.name || planSlug} abonnement`,
          mandateId: payment.mandateId,
          webhookUrl: `${supabaseUrl}/functions/v1/saas-subscribe-webhook-recurring`,
          metadata: { user_id: userId, plan_slug: planSlug },
        },
      );

      const periodStart = new Date();
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      const update = {
        status: "active",
        plan_slug: planSlug,
        mollie_customer_id: payment.customerId,
        mollie_mandate_id: payment.mandateId,
        mollie_subscription_id: subscription.id,
        last_payment_id: payment.id,
        current_period_start: periodStart.toISOString(),
        current_period_end: periodEnd.toISOString(),
        trial_ends_at: null,
      } as Record<string, unknown>;

      if (subRow) {
        await admin.from("subscriptions").update(update).eq("id", subRow.id);
      } else {
        await admin
          .from("subscriptions")
          .insert({ user_id: userId, ...update });
      }

      // ─── Referral conversion: credit referrer with 1 free month ───
      try {
        const { data: ref } = await admin
          .from("referrals")
          .select("id, referrer_user_id, status, credit_months")
          .eq("referred_user_id", userId)
          .maybeSingle();
        if (ref && ref.status === "signed_up") {
          const credit = ref.credit_months ?? 1;
          await admin
            .from("referrals")
            .update({
              status: "credited",
              converted_at: new Date().toISOString(),
              credited_at: new Date().toISOString(),
            })
            .eq("id", ref.id);

          // Bump referrer subscription credit balance
          const { data: refSub } = await admin
            .from("subscriptions")
            .select("id, credit_months_balance")
            .eq("user_id", ref.referrer_user_id)
            .maybeSingle();
          if (refSub) {
            await admin
              .from("subscriptions")
              .update({
                credit_months_balance:
                  (refSub.credit_months_balance ?? 0) + credit,
              })
              .eq("id", refSub.id);
          }

          // Bump aggregate stats on referral_codes
          const { data: rc } = await admin
            .from("referral_codes")
            .select("total_converted, total_credit_months")
            .eq("user_id", ref.referrer_user_id)
            .maybeSingle();
          await admin
            .from("referral_codes")
            .update({
              total_converted: (rc?.total_converted ?? 0) + 1,
              total_credit_months: (rc?.total_credit_months ?? 0) + credit,
            })
            .eq("user_id", ref.referrer_user_id);

          // Analytics
          await admin.from("analytics_events").insert({
            event_name: "referral_signup",
            user_id: ref.referrer_user_id,
            properties: {
              kind: "converted_to_paid",
              referred_user_id: userId,
              credit_months: credit,
            },
          });
        }
      } catch (refErr) {
        console.error("referral credit step failed", refErr);
      }

      // Track paid_conversion
      try {
        await admin.from("analytics_events").insert({
          event_name: "paid_conversion",
          user_id: userId,
          properties: { plan_slug: planSlug, payment_id: payment.id },
        });
      } catch (_e) { /* noop */ }
    } else if (
      payment.status === "failed" ||
      payment.status === "canceled" ||
      payment.status === "expired"
    ) {
      if (subRow) {
        await admin
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("id", subRow.id);
      }
    }

    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error("saas-webhook error:", e);
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
});
