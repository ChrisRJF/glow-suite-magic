// GlowPay (Viva Smart Checkout) subscription checkout for logged-in users.
// Creates a Viva order for the first month of the selected GlowSuite plan and
// records the order in pending_saas_signups + subscriptions (status=pending).
// Activation happens in viva-webhook when the paid event is received.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createVivaOrder, isVivaConfigured, vivaCheckoutUrl } from "../_shared/viva.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!isVivaConfigured()) {
      return new Response(JSON.stringify({ error: "GlowPay niet geconfigureerd" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const planSlug = String(body.plan_slug || "");
    if (!["starter", "growth", "premium"].includes(planSlug)) {
      return new Response(JSON.stringify({ error: "Ongeldig plan" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: plan } = await admin
      .from("subscription_plans")
      .select("*")
      .eq("slug", planSlug)
      .maybeSingle();
    if (!plan) {
      return new Response(JSON.stringify({ error: "Plan niet gevonden" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin =
      req.headers.get("origin") ||
      req.headers.get("referer")?.split("/").slice(0, 3).join("/") ||
      "https://glowsuite.nl";

    const amountCents = Math.round(Number(plan.price_eur) * 100);
    const { orderCode } = await createVivaOrder({
      amountCents,
      description: `GlowSuite ${plan.name} eerste maand`,
      customerEmail: user.email || undefined,
      merchantTrns: `glowsuite-${planSlug}-${user.id.slice(0, 8)}`,
      customerTrns: `GlowSuite ${plan.name}`,
      successUrl: `${origin}/?subscribed=1`,
      failureUrl: `${origin}/prijzen?payment=failed`,
      source: "manual",
      paymentType: "subscription",
    });

    // Track pending signup
    await admin
      .from("pending_saas_signups")
      .upsert(
        {
          order_code: orderCode,
          plan_slug: planSlug,
          email: user.email || null,
          user_id: user.id,
          status: "pending",
          metadata: { kind: "saas_first_viva" },
        },
        { onConflict: "order_code" },
      );

    // Upsert subscription as pending
    const { data: existingSub } = await admin
      .from("subscriptions")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    const subPayload = {
      user_id: user.id,
      plan_slug: planSlug,
      status: "pending",
      last_payment_id: orderCode,
    };
    if (existingSub) {
      await admin.from("subscriptions").update(subPayload).eq("id", existingSub.id);
    } else {
      await admin.from("subscriptions").insert(subPayload);
    }

    return new Response(
      JSON.stringify({ checkout_url: vivaCheckoutUrl(orderCode), order_code: orderCode }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("saas-subscribe-viva error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
