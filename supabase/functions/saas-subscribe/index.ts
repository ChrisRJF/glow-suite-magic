// SaaS subscription checkout — creates Mollie customer + first payment with mandate
// On webhook: activate Mollie subscription for monthly recurring billing
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MOLLIE_API = "https://api.mollie.com/v2";

function getMollieKey(): string {
  const live = Deno.env.get("MOLLIE_LIVE_API_KEY");
  const test = Deno.env.get("MOLLIE_TEST_API_KEY");
  return live || test || "";
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
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Mollie ${method} ${path} failed [${res.status}]: ${JSON.stringify(json)}`,
    );
  }
  return json;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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
      return new Response(JSON.stringify({ error: "Invalid plan" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Get plan
    const { data: plan, error: planErr } = await admin
      .from("subscription_plans")
      .select("*")
      .eq("slug", planSlug)
      .maybeSingle();
    if (planErr || !plan) {
      return new Response(JSON.stringify({ error: "Plan not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get or create subscription row
    const { data: existingSub } = await admin
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // Create Mollie customer if not yet
    let mollieCustomerId = existingSub?.mollie_customer_id as string | null;
    if (!mollieCustomerId) {
      const customer = await mollie("/customers", "POST", {
        name: user.email || "GlowSuite klant",
        email: user.email,
        metadata: { user_id: user.id },
      });
      mollieCustomerId = customer.id;
    }

    const origin =
      req.headers.get("origin") ||
      req.headers.get("referer")?.split("/").slice(0, 3).join("/") ||
      "https://glowsuite.nl";

    // Create first payment with sequenceType=first to get a mandate
    const payment = await mollie(
      `/customers/${mollieCustomerId}/payments`,
      "POST",
      {
        amount: {
          currency: plan.currency,
          value: Number(plan.price_eur).toFixed(2),
        },
        description: `GlowSuite ${plan.name} — eerste maand`,
        redirectUrl: `${origin}/?subscribed=1`,
        webhookUrl: `${supabaseUrl}/functions/v1/saas-subscribe-webhook`,
        sequenceType: "first",
        metadata: {
          user_id: user.id,
          plan_slug: planSlug,
          kind: "saas_first",
        },
      },
    );

    // Upsert subscription
    const subPayload = {
      user_id: user.id,
      plan_slug: planSlug,
      status: "pending",
      mollie_customer_id: mollieCustomerId,
      last_payment_id: payment.id,
    };
    if (existingSub) {
      await admin.from("subscriptions").update(subPayload).eq("id", existingSub.id);
    } else {
      await admin.from("subscriptions").insert(subPayload);
    }

    return new Response(
      JSON.stringify({ checkout_url: payment._links?.checkout?.href }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("saas-subscribe error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
