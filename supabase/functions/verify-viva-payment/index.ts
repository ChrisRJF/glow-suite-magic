// Redirect-fallback verification for Viva Smart Checkout.
// Called from /payment/success when the webhook hasn't arrived yet.
// Looks up the transaction at Viva and reconciles the local payment.
// Idempotent: never demotes a paid payment.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getVivaTransaction } from "../_shared/viva.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function mapStatus(statusId: string): "paid" | "failed" | "cancelled" | "pending" {
  if (statusId === "F") return "paid";
  if (statusId === "E") return "failed";
  if (statusId === "X") return "cancelled";
  return "pending";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const transactionId: string | undefined = body?.transaction_id || body?.t;
    const orderCode: string | undefined = body?.order_code || body?.s;
    if (!transactionId && !orderCode) return json({ error: "transaction_id or order_code required" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Find local payment first (so we can keep merchant isolation).
    let payment: any = null;
    if (orderCode) {
      const { data } = await supabase.from("payments")
        .select("*")
        .or(`mollie_payment_id.eq.${orderCode},checkout_reference.eq.${orderCode}`)
        .eq("provider", "viva").limit(1).maybeSingle();
      payment = data;
    }
    if (!payment && transactionId) {
      const { data } = await supabase.from("payments").select("*")
        .contains("metadata", { viva_transaction_id: transactionId }).limit(1).maybeSingle();
      payment = data;
    }
    if (!payment) return json({ status: "unknown", reason: "payment_not_found" });

    if (payment.status === "paid") return json({ status: "paid", idempotent: true });
    if (payment.is_demo) return json({ status: payment.status, demo: true });

    // Ask Viva for the truth.
    if (!transactionId) return json({ status: payment.status, reason: "no_transaction_id" });
    let tx;
    try {
      tx = await getVivaTransaction(transactionId);
    } catch (e) {
      console.error("verify-viva-payment lookup failed", e);
      return json({ status: payment.status, reason: "viva_lookup_failed" });
    }
    const newStatus = mapStatus(tx.statusId);
    if (newStatus !== "paid") return json({ status: payment.status, viva_status: newStatus });

    // Mark paid via the same code path as the webhook would have: re-invoke webhook handler
    // with a synthetic payload so all side-effects fire once and the ledger records this.
    const syntheticPayload = {
      EventTypeId: 1796,
      EventTypeName: "TransactionPaymentCreated",
      EventId: `redirect_fallback_${transactionId}`,
      EventData: {
        TransactionId: tx.transactionId,
        OrderCode: tx.orderCode,
        StatusId: tx.statusId,
      },
      _source: "redirect_fallback",
    };
    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/viva-webhook`;
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(syntheticPayload),
    }).catch((e) => console.error("self-invoke webhook failed", e));

    return json({ status: "paid", source: "redirect_fallback" });
  } catch (err) {
    console.error("verify-viva-payment error", err);
    return json({ error: "verify_failed" }, 500);
  }
});
