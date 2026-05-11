import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BodySchema = z.object({
  appointment_id: z.string().uuid().optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  membership_id: z.string().uuid().optional().nullable(),
  amount: z.number().positive().max(100000),
  payment_type: z.enum(["deposit", "full", "remainder", "webshop", "membership"]).optional().default("deposit"),
  method: z.enum(["ideal", "bancontact", "creditcard", "applepay", "paypal", "banktransfer"]).optional().default("ideal"),
  is_demo: z.boolean().optional(),
  source: z.enum(["test_button"]).optional(),
  redirect_url: z.string().url().optional(),
});

const REDIRECT_BASE = "https://glowsuite.nl";

async function refreshConnection(admin: ReturnType<typeof createClient>, connection: any) {
  if (connection.mollie_access_token_expires_at && new Date(connection.mollie_access_token_expires_at).getTime() > Date.now() + 120000) return connection;
  const clientId = Deno.env.get("MOLLIE_CLIENT_ID");
  const clientSecret = Deno.env.get("MOLLIE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Mollie Connect is niet volledig geconfigureerd.");
  const response = await fetch("https://api.mollie.com/oauth2/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: connection.mollie_refresh_token, client_id: clientId, client_secret: clientSecret }),
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok) {
    await admin.from("mollie_connections").update({ onboarding_status: "refresh_failed", is_active: false, disconnected_at: new Date().toISOString() }).eq("id", connection.id);
    throw new Error("Mollie account is verlopen. Koppel Mollie opnieuw.");
  }
  const expiresAt = new Date(Date.now() + Math.max(60, Number(token.expires_in || 3600) - 120) * 1000).toISOString();
  await admin.from("mollie_connections").update({ mollie_access_token: token.access_token, mollie_refresh_token: token.refresh_token || connection.mollie_refresh_token, mollie_access_token_expires_at: expiresAt, last_sync_at: new Date().toISOString() }).eq("id", connection.id);
  return { ...connection, mollie_access_token: token.access_token, mollie_refresh_token: token.refresh_token || connection.mollie_refresh_token, mollie_access_token_expires_at: expiresAt };
}

async function mollieFetch(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(`https://api.mollie.com/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.detail || data?.title || data?.message || JSON.stringify(data);
    throw new Error(`Mollie aanvraag mislukt (${response.status}) voor ${path}: ${message}`);
  }
  return data;
}

async function getWebsiteProfile(accessToken: string) {
  try {
    const profile = await mollieFetch("/profiles/me", accessToken);
    if (profile?.id) return profile;
  } catch (_) {
    // Fall back to listing profiles below.
  }
  const profiles = await mollieFetch("/profiles", accessToken);
  const list = profiles?._embedded?.profiles || [];
  const active = list.find((profile: any) => profile.status === "verified") || list.find((profile: any) => profile.status === "unverified") || list[0];
  if (!active?.id) throw new Error("Geen Mollie websiteprofiel gevonden. Maak of activeer eerst een websiteprofiel in Mollie.");
  return active;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Niet geautoriseerd" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Ongeldige JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return new Response(JSON.stringify({
        error: "Ongeldige invoer",
        details: parsed.error.flatten().fieldErrors,
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { appointment_id, customer_id, membership_id, payment_type, method, source, redirect_url } = parsed.data;
    const amount = source === "test_button" ? 1 : parsed.data.amount;

    // Check if demo mode + provider selection
    const { data: settings } = await supabase
      .from("settings")
      .select("id, demo_mode, is_demo, mollie_mode, payment_provider, payment_provider_fallback_enabled")
      .eq("user_id", user.id)
      .maybeSingle();

    const demoMode = Boolean(settings?.is_demo || settings?.demo_mode);
    const provider = ((settings as any)?.payment_provider as string) || "mollie";

    // Route to Viva when selected (test_button stays on Mollie since it tests Mollie Connect specifically)
    if (provider === "viva" && source !== "test_button") {
      const { data: result, error: vivaErr } = await supabase.functions.invoke("create-viva-payment", {
        body: {
          appointment_id,
          customer_id,
          membership_id,
          amount_cents: Math.round(amount * 100),
          payment_type: payment_type === "membership" ? "subscription" : payment_type === "remainder" || payment_type === "webshop" ? "full" : payment_type,
          source: payment_type === "membership" ? "membership" : "manual",
          is_demo: demoMode,
          redirect_url,
        },
      });
      if (vivaErr || (result as any)?.error) {
        return new Response(JSON.stringify({ error: (result as any)?.error || vivaErr?.message || "Viva fout" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        success: true,
        demo: !!(result as any)?.demo,
        provider: "viva",
        payment: { id: (result as any)?.payment_id },
        checkoutUrl: (result as any)?.checkout_url,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    if (demoMode) {
      const demoStatuses = ["paid", "failed", "cancelled"];
      const randomStatus = demoStatuses[Math.floor(Math.random() * 10) < 7 ? 0 : Math.floor(Math.random() * 2) + 1];

      const { data: payment, error: insertError } = await supabase
        .from("payments")
        .insert({
          user_id: user.id,
          appointment_id,
          customer_id,
          membership_id,
          mollie_payment_id: `demo_${crypto.randomUUID().slice(0, 8)}`,
          amount,
          currency: "EUR",
          payment_type,
          status: randomStatus,
          method,
          is_demo: true,
        })
        .select()
        .single();

      if (insertError) {
        return new Response(JSON.stringify({ error: insertError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (appointment_id) {
        const paymentStatus = randomStatus === "paid" ? "betaald" : randomStatus === "failed" ? "mislukt" : "geannuleerd";
        await supabase.from("appointments").update({
          payment_status: paymentStatus,
          amount_paid: randomStatus === "paid" ? amount : 0,
        }).eq("id", appointment_id);
      }

      return new Response(JSON.stringify({
        success: true,
        demo: true,
        payment,
        message: randomStatus === "paid"
          ? "Demo betaling succesvol"
          : randomStatus === "failed"
          ? "Demo betaling mislukt"
          : "Demo betaling geannuleerd",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: rawConnection } = await admin
      .from("mollie_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("salon_id", (settings as any)?.id)
      .eq("is_active", true)
      .is("disconnected_at", null)
      .maybeSingle();

    if (!rawConnection) {
      return new Response(JSON.stringify({ error: "Mollie account is nog niet gekoppeld.", requiresSetup: true }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const connection = await refreshConnection(admin, rawConnection);
    const isTestButton = source === "test_button";
    const profile = isTestButton ? await getWebsiteProfile(connection.mollie_access_token) : null;

    const molliePayload: Record<string, unknown> = {
      amount: { currency: "EUR", value: amount.toFixed(2) },
      description: isTestButton ? "GlowSuite Live Test Payment" : payment_type === "membership" ? "GlowSuite Abonnement" : `GlowSuite ${payment_type === "deposit" ? "Aanbetaling" : "Betaling"}`,
      redirectUrl: isTestButton ? (redirect_url || `${REDIRECT_BASE}/instellingen?tab=integraties`) : `${REDIRECT_BASE}/boeken?status=payment-return`,
      webhookUrl: `${supabaseUrl}/functions/v1/mollie-webhook`,
      method,
      metadata: isTestButton
        ? { source: "test_button", salon_id: user.id, payment_type: "full" }
        : { appointment_id, customer_id, membership_id, salon_id: user.id, payment_type },
    };
    if (profile?.id) molliePayload.profileId = profile.id;

    let mollieData: any;
    try {
      mollieData = await mollieFetch("/payments", connection.mollie_access_token, {
        method: "POST",
        body: JSON.stringify(molliePayload),
      });
    } catch (error) {
      console.error("Mollie payment creation failed", error);
      return new Response(JSON.stringify({ error: (error as Error).message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: payment } = await supabase
      .from("payments")
      .insert({
        user_id: user.id,
        appointment_id: isTestButton ? null : appointment_id,
        customer_id: isTestButton ? null : customer_id,
        membership_id: isTestButton ? null : membership_id,
        mollie_payment_id: mollieData.id,
        amount,
        currency: "EUR",
        payment_type: isTestButton ? "full" : payment_type,
        status: "pending",
        method,
        mollie_method: method,
        is_demo: false,
        provider: "mollie",
        metadata: isTestButton ? { source: "test_button", profile_id: profile?.id || null } : undefined,
      })
      .select()
      .single();

    if (membership_id) {
      await supabase.from("customer_memberships").update({
        last_payment_status: "open",
        status: "payment_issue",
      }).eq("id", membership_id);
    }

    if (appointment_id) {
      await supabase.from("appointments").update({
        payment_status: "in_afwachting",
      }).eq("id", appointment_id);
    }

    return new Response(JSON.stringify({
      success: true,
      demo: false,
      payment,
      checkoutUrl: mollieData._links?.checkout?.href,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
