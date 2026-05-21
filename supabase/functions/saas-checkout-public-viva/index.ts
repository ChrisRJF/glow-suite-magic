// Public GlowPay (Viva Smart Checkout) checkout for SaaS without prior login.
// Creates a Viva order and records the signup intent in pending_saas_signups.
// The viva-webhook completes user provisioning + subscription activation on paid.
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

    const body = await req.json().catch(() => ({}));
    const planSlug = String(body.plan_slug || "");
    const email = String(body.email || "").trim().toLowerCase();
    const salonName = String(body.salon_name || "").trim();
    const fullName = String(body.full_name || "").trim();

    if (!["starter", "growth", "premium"].includes(planSlug)) {
      return new Response(JSON.stringify({ error: "Ongeldig plan" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: "Ongeldig e-mailadres" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
      customerEmail: email,
      customerFullName: fullName || salonName || undefined,
      merchantTrns: `glowsuite-${planSlug}-public`,
      customerTrns: `GlowSuite ${plan.name}`,
      successUrl: `${origin}/login?subscribed=1&email=${encodeURIComponent(email)}`,
      failureUrl: `${origin}/prijzen?payment=failed`,
      source: "manual",
      paymentType: "subscription",
    });

    await admin
      .from("pending_saas_signups")
      .upsert(
        {
          order_code: orderCode,
          plan_slug: planSlug,
          email,
          salon_name: salonName,
          full_name: fullName,
          status: "pending",
          metadata: { kind: "saas_first_public_viva" },
        },
        { onConflict: "order_code" },
      );

    return new Response(
      JSON.stringify({ checkout_url: vivaCheckoutUrl(orderCode), order_code: orderCode }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("saas-checkout-public-viva error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
