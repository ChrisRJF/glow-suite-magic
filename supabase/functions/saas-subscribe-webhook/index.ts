// Mollie webhook for SaaS subscription first payment.
// On paid: creates Mollie subscription (recurring monthly) and activates row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MOLLIE_API = "https://api.mollie.com/v2";

function getMollieKey(): string {
  return (
    Deno.env.get("MOLLIE_LIVE_API_KEY") ||
    Deno.env.get("MOLLIE_TEST_API_KEY") ||
    ""
  );
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
    if (meta.kind !== "saas_first") {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    const userId = meta.user_id as string;
    const planSlug = meta.plan_slug as string;

    const { data: sub } = await admin
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!sub) {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    if (payment.status === "paid" && payment.customerId && payment.mandateId) {
      const { data: plan } = await admin
        .from("subscription_plans")
        .select("*")
        .eq("slug", planSlug)
        .maybeSingle();

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

      await admin
        .from("subscriptions")
        .update({
          status: "active",
          mollie_mandate_id: payment.mandateId,
          mollie_subscription_id: subscription.id,
          current_period_start: periodStart.toISOString(),
          current_period_end: periodEnd.toISOString(),
        })
        .eq("id", sub.id);
    } else if (
      payment.status === "failed" ||
      payment.status === "canceled" ||
      payment.status === "expired"
    ) {
      await admin
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("id", sub.id);
    }

    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error("saas-webhook error:", e);
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
});
