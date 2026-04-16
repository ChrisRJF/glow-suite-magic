import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BodySchema = z.object({
  appointment_id: z.string().uuid().optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  amount: z.number().positive().max(100000),
  payment_type: z.enum(["deposit", "full", "remainder"]).optional().default("deposit"),
  method: z.enum(["ideal", "bancontact", "creditcard", "applepay", "paypal"]).optional().default("ideal"),
  is_demo: z.boolean().optional(),
});

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

    const { appointment_id, customer_id, amount, payment_type, method, is_demo } = parsed.data;

    // Check if demo mode
    const { data: settings } = await supabase
      .from("settings")
      .select("demo_mode, mollie_mode")
      .eq("user_id", user.id)
      .maybeSingle();

    const demoMode = is_demo || settings?.demo_mode || false;

    if (demoMode) {
      const demoStatuses = ["paid", "failed", "cancelled"];
      const randomStatus = demoStatuses[Math.floor(Math.random() * 10) < 7 ? 0 : Math.floor(Math.random() * 2) + 1];

      const { data: payment, error: insertError } = await supabase
        .from("payments")
        .insert({
          user_id: user.id,
          appointment_id,
          customer_id,
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

    const mollieApiKey = Deno.env.get("MOLLIE_API_KEY");

    if (!mollieApiKey) {
      return new Response(JSON.stringify({
        error: "Mollie API key niet geconfigureerd. Gebruik demo modus.",
        requiresSetup: true
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mollieResponse = await fetch("https://api.mollie.com/v2/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mollieApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: { currency: "EUR", value: amount.toFixed(2) },
        description: `GlowSuite ${payment_type === "deposit" ? "Aanbetaling" : "Betaling"}`,
        redirectUrl: `${req.headers.get("origin") || supabaseUrl}/boeken?status=complete`,
        method,
      }),
    });

    const mollieData = await mollieResponse.json();

    if (!mollieResponse.ok) {
      return new Response(JSON.stringify({ error: `Mollie fout: ${JSON.stringify(mollieData)}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: payment } = await supabase
      .from("payments")
      .insert({
        user_id: user.id,
        appointment_id,
        customer_id,
        mollie_payment_id: mollieData.id,
        amount,
        currency: "EUR",
        payment_type,
        status: "pending",
        method,
        is_demo: false,
      })
      .select()
      .single();

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
