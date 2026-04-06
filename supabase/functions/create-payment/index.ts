import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const body = await req.json();
    const { appointment_id, customer_id, amount, payment_type, method, is_demo } = body;

    if (!amount || amount <= 0) {
      return new Response(JSON.stringify({ error: "Ongeldig bedrag" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if demo mode
    const { data: settings } = await supabase
      .from("settings")
      .select("demo_mode, mollie_mode")
      .eq("user_id", user.id)
      .maybeSingle();

    const demoMode = is_demo || settings?.demo_mode || false;

    if (demoMode) {
      // Simulate Mollie payment in demo mode
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
          payment_type: payment_type || "deposit",
          status: randomStatus,
          method: method || "ideal",
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

      // Update appointment payment status
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

    // Production: would call Mollie API here
    // For now, create a pending payment record
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

    // Create Mollie payment
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
        method: method === "ideal" ? "ideal" : method === "bancontact" ? "bancontact" : method === "creditcard" ? "creditcard" : method === "applepay" ? "applepay" : undefined,
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
        payment_type: payment_type || "deposit",
        status: "pending",
        method: method || "ideal",
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
