// Viva Smart Checkout — payment order creator.
// Supports public booking deposits/full and Auto Revenue payment links.
// Demo mode never calls Viva.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";
import { startLiveDeposit, makeDepositDeps } from "../_shared/inactive/isvLivePayments.ts";
import { tenantIsDemo as resolveSalonDemo } from "../_shared/checkoutGuard.ts";
import { livePaymentGate } from "../_shared/inactive/isvLivePaymentGate.ts";
import { vivaCheckoutUrl } from "../_shared/viva.ts";
import {
  createVivaIsvOrder,
  requireMerchantContext,
  isvCredentialKind,
  isvLog,
  isvWarn,
  maskId,
} from "../_shared/vivaIsv.ts";
import { CHECKOUT_MARKER, isInternalCheckoutCall, resolveCheckoutTenant, tenantIsDemo, loadLiveKyc, liveKycReady, environmentMatches } from "../_shared/checkoutGuard.ts";


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
  payment_type: z.enum(["deposit", "full", "subscription", "other", "appointment_checkout"]).default("deposit"),
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
    // Appointment checkout: only via the appointment-checkout function, salon from membership, mode from settings.
    const isCheckout = input.payment_type === "appointment_checkout";
    let ownerId = user.id;
    if (isCheckout) {
      if (!isInternalCheckoutCall(req) || !input.appointment_id) return json({ error: "Niet toegestaan." }, 403);
      const t = await resolveCheckoutTenant(admin, user.id);
      if (!t) return json({ error: "Geen rechten voor afrekenen in deze salon." }, 403);
      ownerId = t.tenantId;
      const demo = await tenantIsDemo(admin, ownerId);
      if (demo === null) return json({ error: "Salonmodus onduidelijk." }, 409);
      input.is_demo = demo;
      if (!demo) {
        if (!environmentMatches(false, Deno.env.get("VIVA_ENVIRONMENT"))) return json({ error: "Live betaalomgeving niet actief." }, 409);
        if (!liveKycReady(await loadLiveKyc(admin, ownerId), "link")) {
          return json({ error: "Verificatie (KYC) of online betalen is nog niet actief voor deze salon.", code: "kyc_not_ready" }, 409);
        }
      }
    }
    // Real salon payment links use the same guarded ISV path. SaaS functions are separate and untouched.
    const salonDemo = await resolveSalonDemo(admin, ownerId);
    if (salonDemo === null) return json({ error: "Salonmodus onduidelijk." }, 409);
    if (!salonDemo) {
      const tenant = await resolveCheckoutTenant(admin, user.id);
      if (!tenant || !["eigenaar", "admin", "manager", "financieel"].includes(tenant.role)) return json({ error: "Niet toegestaan." }, 403);
      ownerId = tenant.tenantId;
      if (!input.appointment_id || input.membership_id) return json({ error: "Alleen afspraakgebonden betaallinks zijn beschikbaar." }, 409);
      const r = await admin.from("appointments").select("id,user_id,customer_id,price,deposit_amount").eq("id", input.appointment_id).eq("user_id", ownerId).maybeSingle();
      if (r.error || !r.data || (input.customer_id && input.customer_id !== r.data.customer_id)) return json({ error: "Afspraak niet gevonden." }, 403);
      if (isCheckout) return json({ error: "Live afrekenen blijft geblokkeerd tot saldoverificatie is aangesloten." }, 409);
      const amount = Math.round(Number(input.payment_type === "deposit" ? r.data.deposit_amount : r.data.price) * 100);
      const ret = "https://glowsuite.nl/boeken?status=payment-return";
      const live = await startLiveDeposit({ tenantId: ownerId, source: "payment_link", idempotencyKey: `appointment:${input.appointment_id}:${input.payment_type === "deposit" ? "deposit" : "full"}`,
        amountCents: amount, description: "GlowPay betaling", successUrl: ret, failureUrl: ret, refs: { appointment_id: input.appointment_id, customer_id: r.data.customer_id, payment_type: input.payment_type === "deposit" ? "deposit" : "full" } }, makeDepositDeps(admin, (n) => Deno.env.get(n)));
      return live.ok ? json({ success: true, demo: false, provider: "viva", payment_id: live.paymentId, checkout_url: live.checkoutUrl }) : json({ error: "Online betalen is nog niet beschikbaar. Er is niets afgeschreven.", code: live.reason }, 409);
    }
    // LIVE KYC payment gate (all Smart Checkout routes): demo/live from salon settings only.
    const gate = await livePaymentGate(ownerId, "link", { admin, env: (n) => Deno.env.get(n), fetch, providerEnv: Deno.env.get("VIVA_ENVIRONMENT") });
    if (!gate.ok) {
      return json({ error: "Online betalen is nog niet actief voor deze salon (verificatie niet bevestigd).", code: "live_payment_blocked", reason: gate.reason }, 409);
    }
    input.is_demo = gate.demo;
    const { data: settings } = await admin
      .from("settings")
      .select("id, demo_mode, is_demo, payment_provider, viva_status, viva_live_enabled, viva_demo_enabled")
      .eq("user_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const demoMode = gate.demo === true;
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
      if (appt.user_id !== ownerId) return json({ error: "Niet geautoriseerd voor deze afspraak." }, 403);

      // If the appointment requires a deposit, the requested amount cannot be lower.
      // Checkout amount = open balance computed from the ledger by the checkout route; never raised to the deposit.
      if (appt.payment_required && !isCheckout) {
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
        .in("status", isCheckout ? ["pending", "open"] : ["pending", "open", "paid"]);
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
      ...(isCheckout ? { checkout: CHECKOUT_MARKER, created_by_user_id: user.id } : {}),
      total_amount_cents: amountCents,
    };

    if (demoMode) {
      const fakeOrderCode = `demo_viva_${crypto.randomUUID().slice(0, 8)}`;
      const checkoutUrl = "/boeken?status=demo-viva-payment";
      const { data: payment, error: insertErr } = await admin
        .from("payments")
        .insert({
          user_id: ownerId,
          appointment_id: input.appointment_id,
          customer_id: input.customer_id,
          membership_id: input.membership_id,
          amount: amountEuros,
          currency: "EUR",
          payment_type: input.payment_type === "subscription" ? "membership" : (input.payment_type === "other" || isCheckout) ? "full" : input.payment_type,
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

    if (isvCredentialKind() === "none") {
      return json({ error: "GlowPay is nog niet gekoppeld.", requiresSetup: true }, 400);
    }

    // ---- ISV MERCHANT SCOPE ----
    // The merchant is derived from the authenticated user only. Never from the
    // request body, the frontend, or a URL parameter.
    const merchantResult = await requireMerchantContext(admin, ownerId);
    if (!merchantResult.ok || !merchantResult.context) {
      isvWarn("merchant_context_missing", {
        fn: "create-viva-payment",
        user_id: user.id,
        reason: merchantResult.error,
      });
      return json({
        error: merchantResult.message || "GlowPay merchant-koppeling ontbreekt.",
        requiresSetup: true,
        code: merchantResult.error,
      }, 409);
    }
    const { merchantId, sourceCode } = merchantResult.context;

    isvLog("payment_request_context", {
      fn: "create-viva-payment",
      user_id: user.id,
      merchant_id: maskId(merchantId),
      source: input.source,
      payment_type: input.payment_type,
      amount_cents: amountCents,
    });

    const origin = req.headers.get("origin") || "https://glowsuite.nl";
    const redirectUrl =
      input.redirect_url ||
      (input.source === "auto_revenue"
        ? `${origin}/boeken?status=payment-return&offer=${input.offer_id || ""}`
        : `${origin}/boeken?status=payment-return`);

    let order;
    try {
      order = await createVivaIsvOrder({
        merchantId,
        sourceCode,
        amountCents: amountCents,
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
      });
    } catch (e: any) {
      isvWarn("payment_order_failed", {
        fn: "create-viva-payment",
        user_id: user.id,
        merchant_id: maskId(merchantId),
        viva_status: e?.status ?? null,
        viva_error_code: e?.vivaErrorCode ?? null,
      });
      return json({
        error: "Viva-betaling kon niet worden gestart.",
        viva_status: e?.status ?? null,
        viva_error_code: e?.vivaErrorCode ?? null,
      }, 502);
    }




    const checkoutUrl = vivaCheckoutUrl(order.orderCode);

    const { data: payment, error: insertErr } = await admin
      .from("payments")
      .insert({
        user_id: ownerId,
        appointment_id: input.appointment_id,
        customer_id: input.customer_id,
        membership_id: input.membership_id,
        amount: amountEuros,
        currency: "EUR",
        payment_type: input.payment_type === "subscription" ? "membership" : (input.payment_type === "other" || isCheckout) ? "full" : input.payment_type,
        status: "pending",
        method: "viva",
        is_demo: false,
        provider: "viva",
        mollie_payment_id: order.orderCode, // store orderCode as string in shared slot
        checkout_reference: order.orderCode,
        viva_merchant_id: merchantId,
        viva_source_code: sourceCode,
        metadata: {
          ...baseMetadata,
          viva_order_code: order.orderCode,
          viva_merchant_id: merchantId,
          checkout_url: checkoutUrl,
        },

      })
      .select()
      .single();
    if (insertErr) return json({ error: insertErr.message }, 500);

    if (input.appointment_id && !isCheckout) {
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
