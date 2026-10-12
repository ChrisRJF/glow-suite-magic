// Initiate a sale on a Viva Cloud Terminal.
// POST /functions/v1/create-viva-terminal-payment
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { vivaPosEnv, getVivaPosAccessToken, isVivaPosConfigured, vivaPosSourceCode, vivaPosCredentialKind } from "../_shared/viva.ts";
import { requireMerchantContext, isvWarn, maskId } from "../_shared/vivaIsv.ts";
import { CHECKOUT_MARKER, isInternalCheckoutCall, resolveCheckoutTenant, tenantIsDemo, loadLiveKyc, liveKycReady, environmentMatches } from "../_shared/checkoutGuard.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (!claims?.claims?.sub) return json({ error: "unauthorized" }, 401);
    const actorId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const isCheckout = body?.checkout === CHECKOUT_MARKER;
    // Kassa orders: only via the kassa-checkout function; everything is taken from kassa_begin_attempt.
    const isKassa = typeof body?.kassa_order_id === "string";
    let userId = actorId; // salon owner id used for all salon-scoped lookups
    const {
      terminal_id,
      appointment_id = null,
      customer_id = null,
      amount_cents,
      description = "Terminal payment",
      source = "manual",
      idempotency_key = null,
    } = body || {};
    let { is_demo = false, tip_cents = 0 } = body || {};

    let amt = Number(amount_cents);
    if (!isKassa && (!Number.isFinite(amt) || amt < 30)) return json({ error: "amount_too_small", message: "amount_cents must be >= 30" }, 400);
    if (!terminal_id || typeof terminal_id !== "string") return json({ error: "terminal_id_required" }, 400);
    const allowedSources = ["appointment", "checkout", "manual", "auto_revenue", "membership"];
    if (!allowedSources.includes(source)) return json({ error: "invalid_source" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Appointment checkout: only via the appointment-checkout function; salon from membership,
    // demo/live from salon settings, live requires verified KYC + terminal capability.
    if (isCheckout) {
      if (!isInternalCheckoutCall(req) || !appointment_id) return json({ error: "forbidden" }, 403);
      const t = await resolveCheckoutTenant(admin, actorId);
      if (!t) return json({ error: "forbidden" }, 403);
      userId = t.tenantId;
      const demo = await tenantIsDemo(admin, userId);
      if (demo === null) return json({ error: "mode_unclear" }, 409);
      is_demo = demo;
      tip_cents = 0;
      if (!environmentMatches(demo, Deno.env.get("VIVA_POS_ENVIRONMENT") || Deno.env.get("VIVA_ENVIRONMENT"))) {
        return json({ error: "environment_mismatch", message: "Betaalomgeving past niet bij de salonmodus." }, 409);
      }
      if (!demo && !liveKycReady(await loadLiveKyc(admin, userId), "terminal")) {
        return json({ error: "kyc_not_ready", message: "Verificatie (KYC) of pinbevoegdheid is nog niet actief voor deze salon." }, 409);
      }
    }

    let kassaOrderId: string | null = null;
    if (isKassa) {
      if (isCheckout || !isInternalCheckoutCall(req) || appointment_id) return json({ error: "forbidden" }, 403);
      const b = await admin.rpc("kassa_begin_attempt", { _actor: actorId, _order_id: body.kassa_order_id });
      const r = b.data as any;
      // The calling route already opened this attempt; anything else (new attempt, other key) is refused.
      if (b.error || !r?.ok || r.resumed !== true || r.idempotency_key !== idempotency_key || r.payment_id) return json({ error: "forbidden" }, 403);
      const f = await admin.from("tenant_feature_flags").select("kassa_orders_enabled").eq("tenant_id", r.tenant_id).maybeSingle();
      if (f.error || (f.data as any)?.kassa_orders_enabled !== true) return json({ error: "disabled" }, 403);
      if (!environmentMatches(r.is_demo === true, Deno.env.get("VIVA_POS_ENVIRONMENT") || Deno.env.get("VIVA_ENVIRONMENT"))) {
        return json({ error: "environment_mismatch", message: "Betaalomgeving past niet bij de salonmodus." }, 409);
      }
      if (r.is_demo !== true) {
        const live = await admin.rpc("kassa_live_allowed", { _tenant: r.tenant_id, _method: "terminal" });
        if (live.error || live.data !== true) return json({ error: "live_not_allowed" }, 409);
      }
      userId = r.tenant_id; amt = Number(r.total_cents); is_demo = r.is_demo === true; tip_cents = 0;
      customer_id = r.customer_id ?? null; kassaOrderId = String(body.kassa_order_id);
      if (!Number.isInteger(amt) || amt < 30) return json({ error: "invalid_total" }, 409);
    }

    // Verify terminal ownership and active status
    const { data: terminal, error: terErr } = await admin
      .from("viva_terminals")
      .select("*")
      .eq("user_id", userId)
      .eq("is_demo", !!is_demo)
      .eq("terminal_id", terminal_id)
      .maybeSingle();
    if (terErr) return json({ error: "terminal_lookup_failed", detail: terErr.message }, 500);
    if (!terminal) return json({ error: "terminal_not_found" }, 404);
    if (terminal.status !== "active") return json({ error: "terminal_inactive" }, 400);

    // ---- ISV MERCHANT SCOPE (live only) ----
    // The terminal must demonstrably belong to the same Viva merchant as the
    // signed-in salon. Merchant identifiers are never taken from the request.
    let merchantCtx: { merchantId: string; sourceCode: string | null } | null = null;
    if (!is_demo) {
      const merchantResult = await requireMerchantContext(admin, userId);
      if (!merchantResult.ok || !merchantResult.context) {
        isvWarn("terminal_merchant_context_missing", {
          fn: "create-viva-terminal-payment",
          user_id: userId,
          reason: merchantResult.error,
        });
        return json({
          error: merchantResult.message || "GlowPay merchant-koppeling ontbreekt.",
          code: merchantResult.error,
        }, 409);
      }
      merchantCtx = {
        merchantId: merchantResult.context.merchantId,
        sourceCode: merchantResult.context.sourceCode,
      };

      const terminalMerchantRow = (terminal as any).connected_merchant_id;
      const terminalAccountId = (terminal as any).viva_account_id;
      const ownsByRow = terminalMerchantRow && terminalMerchantRow === merchantResult.context.merchant.id;
      const ownsByAccount = terminalAccountId && terminalAccountId === merchantResult.context.merchant.viva_account_id;
      if (!ownsByRow && !ownsByAccount) {
        isvWarn("terminal_merchant_mismatch", {
          fn: "create-viva-terminal-payment",
          user_id: userId,
          merchant_id: maskId(merchantCtx.merchantId),
          terminal_id: maskId(terminal_id),
        });
        return json({
          error: "Deze terminal is niet aantoonbaar gekoppeld aan de merchant van deze salon.",
          code: "terminal_merchant_mismatch",
        }, 409);
      }
    }


    // Server-side amount enforcement: when paying an appointment, cap the
    // amount to the appointment's outstanding balance + tip. Prevents a
    // tampered client from overcharging the customer.
    let appointmentRef: any = null;
    if (appointment_id) {
      const { data: appt, error: apptErr } = await admin
        .from("appointments")
        .select("id, user_id, price, amount_paid, payment_status, customer_id")
        .eq("id", appointment_id)
        .maybeSingle();
      if (apptErr) return json({ error: "appointment_lookup_failed", detail: apptErr.message }, 500);
      if (!appt) return json({ error: "appointment_not_found" }, 404);
      if (appt.user_id !== userId) return json({ error: "appointment_not_yours" }, 403);
      appointmentRef = appt;
      const tipC = Math.max(0, Number(tip_cents) || 0);
      if (isCheckout) {
        // Amount was computed from the ledger by the checkout route; it may never exceed the price.
        if (amt > Math.round(Number(appt.price || 0) * 100)) return json({ error: "amount_exceeds_price" }, 409);
      } else {
        const outstandingCents = Math.max(0, Math.round((Number(appt.price || 0) - Number(appt.amount_paid || 0)) * 100));
        const maxAllowed = outstandingCents + tipC;
        if (outstandingCents > 0 && amt > maxAllowed) amt = maxAllowed;
        if (appt.payment_status === "paid" && amt > tipC) {
          return json({ error: "appointment_already_paid" }, 409);
        }
      }
    }

    const sessionId = crypto.randomUUID();
    const idemKey = (typeof idempotency_key === "string" && idempotency_key.length >= 8) ? idempotency_key : sessionId;

    // Idempotent return: same idempotency_key for same user reuses existing row.
    {
      const { data: existing } = await admin
        .from("payments")
        .select("id, status, metadata")
        .eq("user_id", userId)
        .eq("method", "terminal")
        .contains("metadata", { idempotency_key: idemKey })
        .maybeSingle();
      if (existing) {
        return json({
          payment_id: existing.id,
          terminal_status: (existing.metadata as any)?.terminal_status || existing.status || "pending",
          provider_reference: (existing.metadata as any)?.provider_reference || null,
          session_id: (existing.metadata as any)?.session_id || null,
          idempotent: true,
        });
      }
    }

    // Create pending payment row
    const { data: payment, error: payErr } = await admin
      .from("payments")
      .insert({
        user_id: userId,
        appointment_id,
        customer_id,
        amount: amt / 100,
        currency: "EUR",
        payment_type: "full",
        status: "pending",
        method: "terminal",
        payment_method: "terminal",
        provider: "viva",
        is_demo: !!is_demo,
        checkout_reference: sessionId,
        viva_merchant_id: merchantCtx?.merchantId || null,
        viva_source_code: merchantCtx?.sourceCode || null,
        metadata: {
          viva_merchant_id: merchantCtx?.merchantId || null,

          terminal_id,
          terminal_row_id: terminal.id,
          source_terminal_id: (terminal as any).source_terminal_id || terminal_id,
          source,
          appointment_id,
          customer_id,
          channel: "cloud_terminal",
          created_by: "create-viva-terminal-payment",
          session_id: sessionId,
          idempotency_key: idemKey,
          tip_cents: Math.max(0, Number(tip_cents) || 0),
          appointment_total: appointmentRef?.price ?? null,
          ...(isCheckout ? { checkout: CHECKOUT_MARKER, created_by_user_id: actorId } : {}),
          ...(kassaOrderId ? { kassa_order_id: kassaOrderId, source: "kassa", created_by_user_id: actorId } : {}),
          environment: is_demo ? "demo" : (Deno.env.get("VIVA_ENVIRONMENT") || "demo"),
        },
      })
      .select()
      .single();
    if (payErr) return json({ error: "payment_create_failed", detail: payErr.message }, 500);
    await admin.from("payment_status_history").insert({
      payment_id: payment.id,
      old_status: null,
      new_status: "pending",
      source: "manual",
    }).then(({ error }) => {
      if (error) console.error("[create-viva-terminal-payment] audit insert failed", { payment_id: payment.id, error: error.message });
    });

    // Touch terminal usage
    await admin
      .from("viva_terminals")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", terminal.id);

    // Call Viva Cloud Terminal API
    let providerReference: string | null = null;
    let terminalStatus = "initiated";
    let providerError: string | null = null;
    let providerErrorCode = "unknown";
    let providerErrorMessage = "";
    let vivaResponseBody: any = null;
    let vivaHttpStatus: number | null = null;
    const sourceTerminalId = (terminal as any).source_terminal_id || terminal_id;
    const virtualId = (terminal as any).virtual_id || null;
    const environment = is_demo ? "demo" : (Deno.env.get("VIVA_POS_ENVIRONMENT") || Deno.env.get("VIVA_ENVIRONMENT") || "demo");
    const credentialKind = vivaPosCredentialKind();

    const logCtx = {
      terminal_id,
      source_terminal_id: sourceTerminalId,
      virtual_id: virtualId,
      session_id: sessionId,
      environment,
      credential_kind: credentialKind,
      payment_id: payment.id,
    };
    console.log("[create-viva-terminal-payment] initiating", logCtx);

    if (isVivaPosConfigured()) {
      try {
        const { token, kind } = await getVivaPosAccessToken();
        const env = vivaPosEnv();
        // Merchant source code wins for live connected merchants; the global POS
        // source code is only a demo-mode fallback.
        const sourceCode = merchantCtx?.sourceCode || (is_demo ? vivaPosSourceCode() : null);
        const url = `${env.api}/ecr/v1/transactions:sale`;
        const merchantReference = payment.id;
        const requestBody: Record<string, unknown> = {
          sessionId,
          terminalId: terminal_id,
          cashRegisterId: `glowsuite-${userId.slice(0, 8)}`,
          amount: Math.round(amt),
          currencyCode: "978",
          merchantReference,
          customerTrns: description.slice(0, 100),
          preauth: false,
          sourceTerminalId,
          tipAmount: Math.max(0, Number(tip_cents) || 0),
        };
        if (sourceCode) requestBody.sourceCode = sourceCode;
        if (merchantCtx?.merchantId) requestBody.merchantId = merchantCtx.merchantId;
        console.log("[create-viva-terminal-payment] viva request", {
          url,
          credential_kind: kind,
          ...logCtx,
          merchant_id: maskId(merchantCtx?.merchantId),
          amount_cents: Math.round(amt),
        });
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        vivaHttpStatus = res.status;
        const text = await res.text();
        let data: any = {};
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
        vivaResponseBody = data;
        console.log("[create-viva-terminal-payment] viva response", {
          ...logCtx,
          merchant_id: maskId(merchantCtx?.merchantId),
          http_status: res.status,
          viva_error_code: data?.ErrorCode ?? data?.errorCode ?? null,
        });

        console.log("[create-viva-terminal-payment] lifecycle", {
          sessionId,
          transactionId: data?.transactionId ?? data?.TransactionId ?? null,
          paymentId: payment.id,
          merchantReference,
        });

        if (!res.ok) {
          providerErrorCode = String(data?.ErrorCode ?? data?.errorCode ?? data?.error ?? `http_${res.status}`);
          providerErrorMessage = String(
            data?.Message ?? data?.message ?? data?.error_description ?? data?.detail ?? (typeof text === "string" ? text.slice(0, 300) : `HTTP ${res.status}`),
          );
          if (res.status === 401) {
            providerErrorCode = "invalid_credentials";
            providerErrorMessage = environment === "demo"
              ? "GlowPay demo-inloggegevens zijn ongeldig. Controleer de Viva POS API credentials."
              : "GlowPay inloggegevens zijn ongeldig. Controleer de Viva POS API credentials.";
          }
          providerError = `viva_terminal_http_${res.status}: ${providerErrorCode} ${providerErrorMessage}`;
          terminalStatus = "failed_to_initiate";
          console.error("[create-viva-terminal-payment] viva error", { ...logCtx, http_status: res.status, code: providerErrorCode, message: providerErrorMessage, body: data });
        } else {
          providerReference = data?.sessionId || sessionId;
        }
      } catch (e: any) {
        if (e?.status === 401 || /401/.test(String(e?.message || ""))) {
          providerErrorCode = "invalid_credentials";
          providerErrorMessage = environment === "demo"
            ? "GlowPay demo-inloggegevens zijn ongeldig. Controleer de Viva POS API credentials."
            : "GlowPay inloggegevens zijn ongeldig. Controleer de Viva POS API credentials.";
          vivaHttpStatus = 401;
        } else {
          providerErrorCode = "exception";
          providerErrorMessage = (e as Error).message;
        }
        providerError = `viva_terminal_exception: ${providerErrorMessage}`;
        terminalStatus = "failed_to_initiate";
        console.error("[create-viva-terminal-payment] exception", { ...logCtx, error: providerErrorMessage });
      }
    } else {
      providerErrorCode = "viva_not_configured";
      providerErrorMessage = "Viva POS credentials zijn niet geconfigureerd.";
      providerError = "viva_pos_not_configured";
      terminalStatus = "failed_to_initiate";
      console.error("[create-viva-terminal-payment] viva_pos_not_configured", logCtx);
    }

    // Persist provider reference / error in metadata
    const initialTxId = vivaResponseBody?.transactionId ?? vivaResponseBody?.TransactionId ?? null;
    await admin
      .from("payments")
      .update({
        metadata: {
          ...(payment.metadata as any),
          terminal_status: terminalStatus,
          provider_reference: providerReference,
          provider_error: providerError,
          provider_error_code: providerErrorCode,
          provider_error_message: providerErrorMessage,
          viva_http_status: vivaHttpStatus,
          viva_response: vivaResponseBody,
          viva_transaction_id: initialTxId ? String(initialTxId) : (payment.metadata as any)?.viva_transaction_id || null,
          initiated_at: new Date().toISOString(),
        },
        ...(providerError ? { status: "failed", failure_reason: providerError } : {}),
      })
      .eq("id", payment.id);

    if (providerError) {
      return json({
        success: false,
        code: providerErrorCode,
        message: providerErrorMessage || providerError,
        viva_response: vivaResponseBody,
        http_status: vivaHttpStatus,
        payment_id: payment.id,
        error: "terminal_initiation_failed",
        detail: providerErrorMessage || providerError,
      }, 502);
    }

    return json({
      payment_id: payment.id,
      terminal_status: terminalStatus,
      provider_reference: providerReference,
      session_id: sessionId,
    });
  } catch (e) {
    console.error("[create-viva-terminal-payment] error", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
