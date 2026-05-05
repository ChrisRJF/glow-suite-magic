// Auto Revenue deposit payment creator (Mollie ONLY).
// Creates a Mollie payment for a held auto-revenue offer + appointment, returns checkout URL.
// Demo mode: never calls Mollie — returns a simulated checkout URL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLATFORM_FEE_CENTS = 35; // €0.35
const REDIRECT_BASE = "https://glowsuite.nl";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

async function refreshConnection(admin: ReturnType<typeof createClient>, connection: any) {
  if (
    connection.mollie_access_token_expires_at &&
    new Date(connection.mollie_access_token_expires_at).getTime() > Date.now() + 120_000
  ) return connection;
  const clientId = Deno.env.get("MOLLIE_CLIENT_ID");
  const clientSecret = Deno.env.get("MOLLIE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Mollie Connect is niet volledig geconfigureerd.");
  const response = await fetch("https://api.mollie.com/oauth2/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.mollie_refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok) {
    await admin
      .from("mollie_connections")
      .update({ onboarding_status: "refresh_failed", is_active: false, disconnected_at: new Date().toISOString() })
      .eq("id", connection.id);
    throw new Error("Mollie account is verlopen. Koppel Mollie opnieuw.");
  }
  const expiresAt = new Date(Date.now() + Math.max(60, Number(token.expires_in || 3600) - 120) * 1000).toISOString();
  await admin
    .from("mollie_connections")
    .update({
      mollie_access_token: token.access_token,
      mollie_refresh_token: token.refresh_token || connection.mollie_refresh_token,
      mollie_access_token_expires_at: expiresAt,
      last_sync_at: new Date().toISOString(),
    })
    .eq("id", connection.id);
  return {
    ...connection,
    mollie_access_token: token.access_token,
    mollie_refresh_token: token.refresh_token || connection.mollie_refresh_token,
    mollie_access_token_expires_at: expiresAt,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Methode niet toegestaan" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json().catch(() => ({}));
    const { user_id, appointment_id, offer_id, customer_id, is_demo: bodyIsDemo, payment_mode: bodyMode } = body || {};
    if (!user_id || !appointment_id || !offer_id || !customer_id) {
      return json({ error: "user_id, appointment_id, offer_id, customer_id verplicht" }, 400);
    }

    // Load settings (deposit config + payment mode + demo flag)
    const { data: settings } = await admin
      .from("settings")
      .select(
        "id, demo_mode, is_demo, auto_revenue_payment_mode, auto_revenue_deposit_enabled, auto_revenue_deposit_type, auto_revenue_deposit_fixed_cents, auto_revenue_deposit_percentage_bps, auto_revenue_deposit_min_cents, auto_revenue_deposit_max_cents",
      )
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const demoMode = bodyIsDemo === true || Boolean((settings as any)?.is_demo || (settings as any)?.demo_mode);
    const paymentMode: "none" | "deposit" | "full" =
      (bodyMode as any) || ((settings as any)?.auto_revenue_payment_mode as any) || "deposit";

    if (paymentMode === "none") {
      return json({ error: "payment_mode=none vereist geen betaling" }, 400);
    }

    // Load appointment to compute base amount (price)
    const { data: appt } = await admin
      .from("appointments")
      .select("id, user_id, price, service_id")
      .eq("id", appointment_id)
      .maybeSingle();
    if (!appt || appt.user_id !== user_id) return json({ error: "Afspraak niet gevonden" }, 404);

    const priceCents = Math.round(Number(appt.price || 0) * 100);
    const cfg = settings as any;

    let depositCents = 0;
    if (paymentMode === "full") {
      depositCents = priceCents;
    } else {
      const depositType = cfg?.auto_revenue_deposit_type || "fixed";
      const fixedCents = Number(cfg?.auto_revenue_deposit_fixed_cents ?? 1000);
      const pctBps = Number(cfg?.auto_revenue_deposit_percentage_bps ?? 2000);
      const minCents = Number(cfg?.auto_revenue_deposit_min_cents ?? 500);
      const maxCents = Number(cfg?.auto_revenue_deposit_max_cents ?? 2500);
      depositCents = depositType === "percentage"
        ? Math.round((priceCents * pctBps) / 10_000)
        : fixedCents;
      depositCents = clamp(depositCents || fixedCents, minCents, maxCents);
    }

    const totalCents = depositCents + PLATFORM_FEE_CENTS;
    const totalEuros = (totalCents / 100).toFixed(2);
    const paymentType = paymentMode === "full" ? "full" : "deposit";
    const sourceTag = paymentMode === "full" ? "auto_revenue_full" : "auto_revenue_deposit";
    const description = paymentMode === "full" ? "GlowSuite Volledige betaling" : "GlowSuite Aanbetaling";

    if (demoMode) {
      const fakeId = `demo_ar_${crypto.randomUUID().slice(0, 8)}`;
      const checkoutUrl = `${REDIRECT_BASE}/boeken?status=demo-payment&offer=${offer_id}`;
      const { data: payment } = await admin
        .from("payments")
        .insert({
          user_id,
          appointment_id,
          customer_id,
          mollie_payment_id: fakeId,
          amount: totalCents / 100,
          currency: "EUR",
          payment_type: paymentType,
          status: "pending",
          method: "ideal",
          is_demo: true,
          provider: "mollie",
          metadata: {
            source: sourceTag,
            payment_mode: paymentMode,
            offer_id,
            appointment_id,
            customer_id,
            deposit_cents: depositCents,
            platform_fee_cents: PLATFORM_FEE_CENTS,
            total_amount_cents: totalCents,
            checkout_url: checkoutUrl,
            simulated: true,
          },
        })
        .select()
        .single();
      return json({ success: true, demo: true, checkout_url: checkoutUrl, payment, deposit_cents: depositCents, platform_fee_cents: PLATFORM_FEE_CENTS, total_amount_cents: totalCents });
    }

    // LIVE: load Mollie connection
    const { data: rawConnection } = await admin
      .from("mollie_connections")
      .select("*")
      .eq("user_id", user_id)
      .eq("salon_id", (settings as any)?.id)
      .eq("is_active", true)
      .is("disconnected_at", null)
      .maybeSingle();
    if (!rawConnection) return json({ error: "Mollie account is nog niet gekoppeld.", requiresSetup: true }, 400);
    const connection = await refreshConnection(admin, rawConnection);

    const molliePayload: Record<string, unknown> = {
      amount: { currency: "EUR", value: totalEuros },
      description: "GlowSuite Aanbetaling",
      redirectUrl: `${REDIRECT_BASE}/boeken?status=payment-return&offer=${offer_id}`,
      webhookUrl: `${SUPABASE_URL}/functions/v1/mollie-webhook`,
      method: "ideal",
      metadata: {
        source: "auto_revenue_deposit",
        appointment_id,
        offer_id,
        customer_id,
        salon_id: user_id,
        payment_type: "deposit",
        deposit_cents: depositCents,
        platform_fee_cents: PLATFORM_FEE_CENTS,
        total_amount_cents: totalCents,
      },
    };

    const mollieRes = await fetch("https://api.mollie.com/v2/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.mollie_access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(molliePayload),
    });
    const mollieData = await mollieRes.json().catch(() => ({}));
    if (!mollieRes.ok) {
      const message = (mollieData as any)?.detail || (mollieData as any)?.title || "Mollie aanvraag mislukt";
      return json({ error: message }, 400);
    }

    const checkoutUrl = (mollieData as any)?._links?.checkout?.href || null;

    const { data: payment } = await admin
      .from("payments")
      .insert({
        user_id,
        appointment_id,
        customer_id,
        mollie_payment_id: (mollieData as any).id,
        amount: totalCents / 100,
        currency: "EUR",
        payment_type: "deposit",
        status: "pending",
        method: "ideal",
        mollie_method: "ideal",
        is_demo: false,
        provider: "mollie",
        metadata: {
          source: "auto_revenue_deposit",
          offer_id,
          appointment_id,
          customer_id,
          deposit_cents: depositCents,
          platform_fee_cents: PLATFORM_FEE_CENTS,
          total_amount_cents: totalCents,
          checkout_url: checkoutUrl,
        },
      })
      .select()
      .single();

    return json({
      success: true,
      demo: false,
      checkout_url: checkoutUrl,
      payment,
      deposit_cents: depositCents,
      platform_fee_cents: PLATFORM_FEE_CENTS,
      total_amount_cents: totalCents,
    });
  } catch (error) {
    console.error("create-auto-revenue-payment error", error);
    return json({ error: (error as Error).message || "Onbekende fout" }, 500);
  }
});
