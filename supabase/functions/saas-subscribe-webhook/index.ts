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
                full_name: meta.full_name || "",
              },
            });
          if (createErr) {
            console.error("createUser failed", createErr);
          } else {
            userId = created?.user?.id;
            // Send magic link so the user can sign in without a password
            const origin =
              payment.redirectUrl?.split("/").slice(0, 3).join("/") ||
              "https://glowsuite.nl";
            await admin.auth.admin
              .generateLink({
                type: "magiclink",
                email,
                options: { redirectTo: `${origin}/?subscribed=1` },
              })
              .catch((e) => console.error("magic link gen failed", e));
          }
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
