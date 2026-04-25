// Mollie webhook for RECURRING SaaS subscription payments.
// Triggered for every monthly renewal payment of a Mollie subscription.
// Idempotent: re-receiving the same payment id will not duplicate side effects.
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

async function mollie(path: string, method: string): Promise<any> {
  const key = getMollieKey();
  if (!key) throw new Error("Mollie API key not configured");
  const res = await fetch(`${MOLLIE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Mollie ${method} ${path} [${res.status}]: ${JSON.stringify(json)}`,
    );
  }
  return json;
}

async function writeAudit(
  admin: ReturnType<typeof createClient>,
  userId: string | null,
  action: string,
  targetId: string | null,
  details: Record<string, unknown>,
) {
  try {
    await admin.from("audit_logs").insert({
      user_id: userId ?? "00000000-0000-0000-0000-000000000000",
      actor_user_id: null,
      action,
      target_type: "saas_subscription",
      target_id: targetId,
      details,
      is_demo: false,
    });
  } catch (e) {
    console.error("audit log insert failed:", e);
  }
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

    // 1. Fetch payment from Mollie
    const payment = await mollie(`/payments/${paymentId}`, "GET");
    const meta = payment.metadata || {};
    const sequenceType = payment.sequenceType; // "first" | "recurring" | "oneoff"
    const mollieSubscriptionId =
      payment.subscriptionId ||
      payment._links?.subscription?.href?.split("/").pop() ||
      null;

    // Guard: this webhook is ONLY for recurring SaaS payments.
    // - First payments are handled by saas-subscribe-webhook.
    // - GlowPay / salon-customer payments use create-payment + mollie-webhook
    //   and never have a Mollie subscription attached.
    if (sequenceType !== "recurring" || !mollieSubscriptionId) {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    // 2. Find matching subscription row
    let userId: string | null = null;
    let subRow: any = null;

    const { data: bySubId } = await admin
      .from("subscriptions")
      .select("*")
      .eq("mollie_subscription_id", mollieSubscriptionId)
      .maybeSingle();

    if (bySubId) {
      subRow = bySubId;
      userId = bySubId.user_id;
    } else if (meta.user_id) {
      const { data: byUser } = await admin
        .from("subscriptions")
        .select("*")
        .eq("user_id", String(meta.user_id))
        .maybeSingle();
      if (byUser) {
        subRow = byUser;
        userId = byUser.user_id;
      }
    }

    if (!subRow) {
      await writeAudit(admin, null, "saas_recurring_webhook_no_match", paymentId, {
        mollie_subscription_id: mollieSubscriptionId,
        payment_status: payment.status,
      });
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    // 3. Idempotency: if this exact payment was already processed, skip mutations.
    if (subRow.last_payment_id === paymentId && subRow.status === "active" && payment.status === "paid") {
      await writeAudit(admin, userId, "saas_recurring_webhook_duplicate", paymentId, {
        payment_status: payment.status,
      });
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    // 4. Verify Mollie subscription state — handles cancellations.
    let mollieSub: any = null;
    if (payment.customerId) {
      try {
        mollieSub = await mollie(
          `/customers/${payment.customerId}/subscriptions/${mollieSubscriptionId}`,
          "GET",
        );
      } catch (e) {
        console.error("Failed to fetch Mollie subscription:", e);
      }
    }

    // 5a. Subscription canceled at Mollie → mark canceled
    if (mollieSub && (mollieSub.status === "canceled" || mollieSub.status === "suspended")) {
      const update: Record<string, unknown> = {
        status: "canceled",
        canceled_at: new Date().toISOString(),
        last_payment_id: paymentId,
      };
      await admin.from("subscriptions").update(update).eq("id", subRow.id);
      await writeAudit(admin, userId, "saas_recurring_subscription_canceled", paymentId, {
        mollie_subscription_id: mollieSubscriptionId,
        mollie_subscription_status: mollieSub.status,
      });
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    // 5b. Payment paid → renew period, ensure active
    if (payment.status === "paid") {
      const periodStart = payment.paidAt ? new Date(payment.paidAt) : new Date();
      // Prefer Mollie's nextPaymentDate when available
      let periodEnd: Date;
      if (mollieSub?.nextPaymentDate) {
        periodEnd = new Date(mollieSub.nextPaymentDate);
      } else {
        periodEnd = new Date(periodStart);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      const update: Record<string, unknown> = {
        status: "active",
        current_period_start: periodStart.toISOString(),
        current_period_end: periodEnd.toISOString(),
        last_payment_id: paymentId,
        canceled_at: null,
      };
      await admin.from("subscriptions").update(update).eq("id", subRow.id);

      await writeAudit(admin, userId, "saas_recurring_payment_paid", paymentId, {
        mollie_subscription_id: mollieSubscriptionId,
        amount: payment.amount,
        method: payment.method,
        period_end: periodEnd.toISOString(),
      });
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    // 5c. Payment failed/canceled/expired → past_due
    if (
      payment.status === "failed" ||
      payment.status === "canceled" ||
      payment.status === "expired"
    ) {
      const update: Record<string, unknown> = {
        status: "past_due",
        last_payment_id: paymentId,
      };
      await admin.from("subscriptions").update(update).eq("id", subRow.id);

      await writeAudit(admin, userId, "saas_recurring_payment_failed", paymentId, {
        mollie_subscription_id: mollieSubscriptionId,
        payment_status: payment.status,
        failure_reason:
          payment.details?.failureReason ||
          payment.details?.bankReasonCode ||
          null,
        amount: payment.amount,
      });
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    // 5d. Pending / open / authorized → log only, no state change
    await writeAudit(admin, userId, "saas_recurring_payment_pending", paymentId, {
      mollie_subscription_id: mollieSubscriptionId,
      payment_status: payment.status,
    });

    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error("saas-subscribe-webhook-recurring error:", e);
    // Always 200 to Mollie so it does not infinite-retry on internal errors;
    // we have audit_logs + edge function logs for visibility.
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
});
