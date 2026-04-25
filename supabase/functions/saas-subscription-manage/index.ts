// Manage active SaaS subscription: cancel (at period end), reactivate, change plan.
// Authenticated endpoint — uses caller's JWT to identify user.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  if (!key) throw new Error("Mollie API key not configured");
  const res = await fetch(`${MOLLIE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Mollie ${method} ${path} [${res.status}]: ${JSON.stringify(json)}`,
    );
  }
  return json;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    if (!["cancel", "reactivate", "change_plan"].includes(action)) {
      return jsonResponse({ error: "Invalid action" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: sub } = await admin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!sub) return jsonResponse({ error: "No subscription" }, 404);

    // ---- CANCEL: stop renewals at period end, keep access until current_period_end ----
    if (action === "cancel") {
      if (sub.cancel_at_period_end) {
        return jsonResponse({ ok: true, already: true });
      }
      await admin
        .from("subscriptions")
        .update({
          cancel_at_period_end: true,
          canceled_at: new Date().toISOString(),
        })
        .eq("id", sub.id);

      await admin.from("audit_logs").insert({
        user_id: user.id,
        actor_user_id: user.id,
        action: "saas_subscription_cancel_scheduled",
        target_type: "saas_subscription",
        target_id: sub.id,
        details: {
          mollie_subscription_id: sub.mollie_subscription_id,
          period_end: sub.current_period_end,
        },
        is_demo: false,
      });

      return jsonResponse({
        ok: true,
        access_until: sub.current_period_end,
      });
    }

    // ---- REACTIVATE: undo a scheduled cancel (only valid before period_end) ----
    if (action === "reactivate") {
      if (!sub.cancel_at_period_end) {
        return jsonResponse({ ok: true, already: true });
      }
      const periodEndMs = sub.current_period_end
        ? new Date(sub.current_period_end).getTime()
        : 0;
      if (periodEndMs <= Date.now()) {
        return jsonResponse(
          { error: "Period already ended — please subscribe again" },
          400,
        );
      }
      await admin
        .from("subscriptions")
        .update({ cancel_at_period_end: false, canceled_at: null })
        .eq("id", sub.id);

      await admin.from("audit_logs").insert({
        user_id: user.id,
        actor_user_id: user.id,
        action: "saas_subscription_reactivated",
        target_type: "saas_subscription",
        target_id: sub.id,
        details: {},
        is_demo: false,
      });
      return jsonResponse({ ok: true });
    }

    // ---- CHANGE PLAN: cancel old Mollie subscription, create new one with same mandate ----
    if (action === "change_plan") {
      const newPlanSlug = String(body.plan_slug || "");
      if (!["starter", "growth", "premium"].includes(newPlanSlug)) {
        return jsonResponse({ error: "Invalid plan" }, 400);
      }
      if (newPlanSlug === sub.plan_slug) {
        return jsonResponse({ ok: true, unchanged: true });
      }
      if (
        !sub.mollie_customer_id ||
        !sub.mollie_mandate_id ||
        !sub.mollie_subscription_id
      ) {
        return jsonResponse(
          { error: "Subscription not yet active — start checkout first" },
          400,
        );
      }

      const { data: plan } = await admin
        .from("subscription_plans")
        .select("*")
        .eq("slug", newPlanSlug)
        .maybeSingle();
      if (!plan) return jsonResponse({ error: "Plan not found" }, 404);

      // Cancel old Mollie subscription
      try {
        await mollie(
          `/customers/${sub.mollie_customer_id}/subscriptions/${sub.mollie_subscription_id}`,
          "DELETE",
        );
      } catch (e) {
        console.error("change_plan: failed to cancel old Mollie sub", e);
      }

      // Create new Mollie subscription with existing mandate
      const newSub = await mollie(
        `/customers/${sub.mollie_customer_id}/subscriptions`,
        "POST",
        {
          amount: {
            currency: plan.currency,
            value: Number(plan.price_eur).toFixed(2),
          },
          interval: "1 month",
          description: `GlowSuite ${plan.name} abonnement`,
          mandateId: sub.mollie_mandate_id,
          webhookUrl: `${supabaseUrl}/functions/v1/saas-subscribe-webhook-recurring`,
          metadata: { user_id: user.id, plan_slug: newPlanSlug },
        },
      );

      await admin
        .from("subscriptions")
        .update({
          plan_slug: newPlanSlug,
          mollie_subscription_id: newSub.id,
          cancel_at_period_end: false,
          canceled_at: null,
        })
        .eq("id", sub.id);

      await admin.from("audit_logs").insert({
        user_id: user.id,
        actor_user_id: user.id,
        action: "saas_subscription_plan_changed",
        target_type: "saas_subscription",
        target_id: sub.id,
        details: {
          from: sub.plan_slug,
          to: newPlanSlug,
          new_mollie_subscription_id: newSub.id,
        },
        is_demo: false,
      });

      return jsonResponse({ ok: true, new_plan: newPlanSlug });
    }

    return jsonResponse({ error: "Unhandled action" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("saas-subscription-manage error:", msg);
    return jsonResponse({ error: msg }, 500);
  }
});
