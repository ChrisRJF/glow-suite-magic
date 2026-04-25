// Public endpoint: start Mollie checkout for SaaS subscription WITHOUT prior login.
// On webhook (saas-subscribe-webhook): creates Supabase user, sends magic link,
// activates subscription with Mollie recurring billing.
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

async function mollie(path: string, method: string, body?: unknown) {
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

    // Create Mollie customer
    const customer = await mollie("/customers", "POST", {
      name: fullName || salonName || email,
      email,
      metadata: { source: "public_checkout", plan_slug: planSlug },
    });

    const origin =
      req.headers.get("origin") ||
      req.headers.get("referer")?.split("/").slice(0, 3).join("/") ||
      "https://glowsuite.nl";

    // First payment to establish mandate. Webhook activates the subscription
    // and provisions the Supabase user (no trial — direct paid).
    const payment = await mollie(
      `/customers/${customer.id}/payments`,
      "POST",
      {
        amount: {
          currency: plan.currency,
          value: Number(plan.price_eur).toFixed(2),
        },
        description: `GlowSuite ${plan.name} — eerste maand`,
        redirectUrl: `${origin}/login?subscribed=1&email=${encodeURIComponent(email)}`,
        webhookUrl: `${supabaseUrl}/functions/v1/saas-subscribe-webhook`,
        sequenceType: "first",
        metadata: {
          email,
          salon_name: salonName,
          full_name: fullName,
          plan_slug: planSlug,
          kind: "saas_first_public",
        },
      },
    );

    return new Response(
      JSON.stringify({ checkout_url: payment._links?.checkout?.href }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("saas-checkout-public error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
