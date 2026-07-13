// Viva Smart Checkout — payment order creator.
// Supports public booking deposits/full and Auto Revenue payment links.
// Demo mode never calls Viva.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";
import {
  createVivaOrder,
  vivaCheckoutUrl,
  isVivaConfigured,
  type VivaPaymentSource,
  type VivaPaymentType,
} from "../_shared/viva.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BodySchema = z.object({
  appointment_id: z.string().uuid().optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  offer_id: z.string().uuid().optional().nullable(),
  membership_id: z.string().uuid().optional().nullable(),
  amount_cents: z.number().int().positive().max(10_000_00),
  payment_type: z.enum(["deposit", "full", "subscription", "other"]).default("deposit"),
  source: z.enum(["public_booking", "auto_revenue", "membership", "manual"]).default("manual"),
  description: z.string().max(255).optional(),
  customer: z.object({
    fullName: z.string().max(255).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(64).optional(),
  }).optional(),
  is_demo: z.boolean().optional(),
  redirect_url: z.string().url().optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Methode niet toegestaan" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Niet geautoriseerd" }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return json({ error: "Ongeldige invoer", details: parsed.error.flatten().fieldErrors }, 400);
    }

    const input = parsed.data;
    const { data: settings } = await admin
      .from("settings")
      .select("id, demo_mode, is_demo, payment_provider, viva_status, viva_live_enabled, viva_demo_enabled")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const demoMode = input.is_demo === true || Boolean(settings?.is_demo || settings?.demo_mode);
    let amountCents = input.amount_cents;

    // ---- SERVER-SIDE ENFORCEMENT: verify amount + prevent duplicates for appointment-linked payments ----
    if (input.appointment_id) {
      const { data: appt } = await admin
        .from("appointments")
        .select("id, user_id, payment_required, deposit_amount, payment_status")
        .eq("id", input.appointment_id)
        .maybeSingle();
      if (!appt) return json({ error: "Afspraak niet gevonden." }, 404);
      // Cross-tenant guard: caller must own the appointment
      if (appt.user_id !== user.id) return json({ error: "Niet geautoriseerd voor deze afspraak." }, 403);

      // If the appointment requires a deposit, the requested amount cannot be lower.
      if (appt.payment_required) {
        const requiredCents = Math.round(Number(appt.deposit_amount || 0) * 100);
        if (requiredCents > 0 && amountCents < requiredCents) {
          console.warn("[create-viva-payment] amount_cents below required deposit — overriding", {
            appointment_id: input.appointment_id,
            requested: amountCents,
            required: requiredCents,
          });
          amountCents = requiredCents;
        }
      }

      // Idempotency: block a second active/paid payment link for the same appointment.
      const { data: existingPayments } = await admin
        .from("payments")
        .select("id, status")
        .eq("appointment_id", input.appointment_id)
        .in("status", ["pending", "open", "paid"]);
      if (existingPayments && existingPayments.length > 0) {
        return json({
          error: "Er is al een actieve betaallink voor deze afspraak.",
          code: "duplicate_active_payment",
          existing_payment_id: existingPayments[0].id,
        }, 409);
      }
    }

    const amountEuros = Number((amountCents / 100).toFixed(2));

    // Activation gate: only "active" salons may create LIVE Viva orders.
    if (!demoMode) {
      const vivaStatus = String(settings?.viva_status || "not_started");
      const liveAllowed = vivaStatus === "active" && settings?.viva_live_enabled !== false;
      if (!liveAllowed) {
        return json({
          error: "Viva activatie nog niet voltooid voor deze salon.",
          requiresActivation: true,
          viva_status: vivaStatus,
        }, 403);
      }
    } else if (settings?.viva_demo_enabled === false) {
      return json({ error: "Viva demo is uitgeschakeld." }, 403);
    }

    const baseMetadata = {
      provider: "viva",
      source: input.source,
      appointment_id: input.appointment_id ?? null,
      customer_id: input.customer_id ?? null,
      offer_id: input.offer_id ?? null,
      membership_id: input.membership_id ?? null,
      payment_type: input.payment_type,
      total_amount_cents: input.amount_cents,
    };

    if (demoMode) {
      const fakeOrderCode = `demo_viva_${crypto.randomUUID().slice(0, 8)}`;
      const checkoutUrl = "/boeken?status=demo-viva-payment";
      const { data: payment, error: insertErr } = await admin
        .from("payments")
        .insert({
          user_id: user.id,
          appointment_id: input.appointment_id,
          customer_id: input.customer_id,
          membership_id: input.membership_id,
          amount: amountEuros,
          currency: "EUR",
          payment_type: input.payment_type === "subscription" ? "membership" : input.payment_type === "other" ? "full" : input.payment_type,
          status: "pending",
          method: "viva",
          is_demo: true,
          provider: "viva",
          mollie_payment_id: fakeOrderCode, // reused slot — stored as string
          checkout_reference: fakeOrderCode,
          metadata: {
            ...baseMetadata,
            viva_order_code: fakeOrderCode,
            checkout_url: checkoutUrl,
            simulated: true,
          },
        })
        .select()
        .single();
      if (insertErr) return json({ error: insertErr.message }, 500);
      return json({
        success: true,
        demo: true,
        provider: "viva",
        payment_id: payment?.id,
        checkout_url: checkoutUrl,
        order_code: fakeOrderCode,
      });
    }

    if (!isVivaConfigured()) {
      return json({ error: "Viva is nog niet gekoppeld.", requiresSetup: true }, 400);
    }

    const rawSourceCode = (Deno.env.get("VIVA_SOURCE_CODE") || "").trim();
    if (rawSourceCode === "1234") {
      console.warn(JSON.stringify({
        fn: "create-viva-payment",
        stage: "placeholder_source_code_blocked",
        message: "VIVA_SOURCE_CODE is placeholder '1234' — order creation blocked before hitting Viva.",
      }));
      return json({
        error: "VIVA_SOURCE_CODE is placeholder '1234'. Zet deze op 'Default' of je echte Viva Payment Source code, of laat leeg zodat Viva automatisch 'Default' gebruikt.",
        requiresSetup: true,
        code: "viva_source_code_placeholder",
      }, 400);
    }

    console.log(JSON.stringify({
      fn: "create-viva-payment",
      stage: "request_context",
      user_id: user.id,
      source: input.source,
      payment_type: input.payment_type,
      amount_cents: input.amount_cents,
      demoMode: false,
      has_customer: Boolean(input.customer?.email),
      source_code_env: rawSourceCode || null,
    }));

    const origin = req.headers.get("origin") || "https://glowsuite.nl";
    const redirectUrl =
      input.redirect_url ||
      (input.source === "auto_revenue"
        ? `${origin}/boeken?status=payment-return&offer=${input.offer_id || ""}`
        : `${origin}/boeken?status=payment-return`);

    let order;
    try {
      order = await createVivaOrder({
        amountCents: input.amount_cents,
        description: input.description ||
          (input.payment_type === "deposit" ? "GlowSuite Aanbetaling" :
           input.payment_type === "subscription" ? "GlowSuite Abonnement" : "GlowSuite Betaling"),
        customerEmail: input.customer?.email,
        customerFullName: input.customer?.fullName,
        customerPhone: input.customer?.phone,
        merchantTrns: input.description || "GlowSuite",
        customerTrns: input.description || "GlowSuite betaling",
        successUrl: redirectUrl,
        failureUrl: redirectUrl,
        source: input.source as VivaPaymentSource,
        paymentType: input.payment_type as VivaPaymentType,
      });
    } catch (e: any) {
      console.error(JSON.stringify({
        fn: "create-viva-payment",
        stage: "viva_order_failed",
        error: String(e?.message || e),
        viva_status: e?.status ?? null,
        viva_body: e?.body ?? null,
        source_code_used: e?.sourceCodeUsed ?? null,
      }));
      return json({
        error: "Viva-betaling kon niet worden gestart.",
        viva_status: e?.status ?? null,
        viva_error: e?.body ?? null,
        source_code_used: e?.sourceCodeUsed ?? null,
      }, 502);
    }


    const checkoutUrl = vivaCheckoutUrl(order.orderCode);

    const { data: payment, error: insertErr } = await admin
      .from("payments")
      .insert({
        user_id: user.id,
        appointment_id: input.appointment_id,
        customer_id: input.customer_id,
        membership_id: input.membership_id,
        amount: amountEuros,
        currency: "EUR",
        payment_type: input.payment_type === "subscription" ? "membership" : input.payment_type === "other" ? "full" : input.payment_type,
        status: "pending",
        method: "viva",
        is_demo: false,
        provider: "viva",
        mollie_payment_id: order.orderCode, // store orderCode as string in shared slot
        checkout_reference: order.orderCode,
        metadata: {
          ...baseMetadata,
          viva_order_code: order.orderCode,
          checkout_url: checkoutUrl,
        },
      })
      .select()
      .single();
    if (insertErr) return json({ error: insertErr.message }, 500);

    if (input.appointment_id) {
      await admin.from("appointments").update({ payment_status: "in_afwachting" }).eq("id", input.appointment_id);
    }

    return json({
      success: true,
      demo: false,
      provider: "viva",
      payment_id: payment?.id,
      checkout_url: checkoutUrl,
      order_code: order.orderCode,
    });
  } catch (error) {
    console.error("create-viva-payment error", error);
    return json({ error: (error as Error).message || "Onbekende fout" }, 500);
  }
});
