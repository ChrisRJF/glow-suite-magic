// Initiate a sale on a Viva Cloud Terminal.
// POST /functions/v1/create-viva-terminal-payment
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { vivaEnv, getVivaAccessToken, isVivaConfigured } from "../_shared/viva.ts";

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
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const {
      terminal_id,
      appointment_id = null,
      customer_id = null,
      amount_cents,
      description = "Terminal payment",
      source = "manual",
      is_demo = false,
    } = body || {};

    const amt = Number(amount_cents);
    if (!Number.isFinite(amt) || amt < 30) return json({ error: "amount_too_small", message: "amount_cents must be >= 30" }, 400);
    if (!terminal_id || typeof terminal_id !== "string") return json({ error: "terminal_id_required" }, 400);
    const allowedSources = ["appointment", "checkout", "manual", "auto_revenue", "membership"];
    if (!allowedSources.includes(source)) return json({ error: "invalid_source" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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

    const sessionId = crypto.randomUUID();

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
        metadata: {
          terminal_id,
          source,
          appointment_id,
          customer_id,
          channel: "cloud_terminal",
          created_by: "create-viva-terminal-payment",
          session_id: sessionId,
        },
      })
      .select()
      .single();
    if (payErr) return json({ error: "payment_create_failed", detail: payErr.message }, 500);

    // Call Viva Cloud Terminal API
    let providerReference: string | null = null;
    let terminalStatus = "initiated";
    let providerError: string | null = null;

    if (isVivaConfigured()) {
      try {
        const token = await getVivaAccessToken();
        const env = vivaEnv();
        const sourceCode = Deno.env.get("VIVA_SOURCE_CODE")!;
        const url = `${env.api}/ecr/v1/transactions:sale`;
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            terminalId: terminal_id,
            cashRegisterId: `glowsuite-${userId.slice(0, 8)}`,
            amount: Math.round(amt),
            currencyCode: "978",
            merchantReference: payment.id,
            customerTrns: description.slice(0, 100),
            preauth: false,
            sourceTerminalId: terminal_id,
            sourceCode,
          }),
        });
        const text = await res.text();
        let data: any = {};
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
        if (!res.ok) {
          providerError = `viva_terminal_http_${res.status}: ${text.slice(0, 300)}`;
          terminalStatus = "failed_to_initiate";
        } else {
          providerReference = data?.sessionId || sessionId;
        }
      } catch (e) {
        providerError = `viva_terminal_exception: ${(e as Error).message}`;
        terminalStatus = "failed_to_initiate";
      }
    } else {
      providerError = "viva_not_configured";
      terminalStatus = "failed_to_initiate";
    }

    // Persist provider reference / error in metadata
    await admin
      .from("payments")
      .update({
        metadata: {
          ...(payment.metadata as any),
          terminal_status: terminalStatus,
          provider_reference: providerReference,
          provider_error: providerError,
          initiated_at: new Date().toISOString(),
        },
        ...(providerError ? { status: "failed", failure_reason: providerError } : {}),
      })
      .eq("id", payment.id);

    if (providerError) {
      return json({ error: "terminal_initiation_failed", detail: providerError, payment_id: payment.id }, 502);
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
