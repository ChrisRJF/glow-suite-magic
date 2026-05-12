// Scheduled reconciliation for Viva Smart Checkout payments.
// Runs every 5 minutes via pg_cron. For each pending Viva payment created in
// the last 48h, asks Viva for the authoritative status and — when a status
// change is required — re-invokes the viva-webhook with a synthetic payload
// (source=reconciliation) so all side-effects (appointment/customer/email/
// WhatsApp) execute through exactly one code path. Idempotent: never demotes
// paid payments and the webhook ledger guards against double processing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getVivaTransaction, vivaEnv } from "../_shared/viva.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapStatus(statusId: string): "paid" | "failed" | "cancelled" | "pending" {
  if (statusId === "F") return "paid";
  if (statusId === "E") return "failed";
  if (statusId === "X") return "cancelled";
  return "pending";
}

interface ReconcileSummary {
  scanned: number;
  updated: number;
  unchanged: number;
  failed: number;
  no_transaction_id: number;
  details: Array<Record<string, unknown>>;
}

async function reconcileOnce(): Promise<ReconcileSummary> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const summary: ReconcileSummary = {
    scanned: 0, updated: 0, unchanged: 0, failed: 0, no_transaction_id: 0, details: [],
  };

  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: pending, error } = await supabase
    .from("payments")
    .select("id, user_id, status, provider, is_demo, metadata, mollie_payment_id, checkout_reference, created_at")
    .eq("provider", "viva")
    .eq("is_demo", false)
    .in("status", ["pending", "open", "processing"])
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[viva-reconcile] query failed", error);
    return summary;
  }

  const list = pending || [];
  summary.scanned = list.length;
  console.log(`[viva-reconcile] scanning ${list.length} pending viva payments since ${since}`);

  const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/viva-webhook`;

  for (const p of list) {
    const meta = (p.metadata as any) || {};
    const transactionId: string | null = meta.viva_transaction_id || null;
    const orderCode: string | null = meta.viva_order_code || p.mollie_payment_id || p.checkout_reference || null;

    // Mark attempt
    const attemptCount = Number(meta.reconcile_attempts || 0) + 1;
    const lastAttemptAt = new Date().toISOString();

    if (!transactionId) {
      summary.no_transaction_id++;
      await supabase.from("payments").update({
        metadata: { ...meta, reconcile_attempts: attemptCount, last_reconcile_attempt_at: lastAttemptAt, last_reconcile_result: "no_transaction_id" },
      }).eq("id", p.id);
      continue;
    }

    let tx;
    try {
      tx = await getVivaTransaction(transactionId);
    } catch (e) {
      summary.failed++;
      const errMsg = String((e as Error)?.message || e).slice(0, 500);
      console.warn(`[viva-reconcile] viva lookup failed for tx=${transactionId}`, e);
      await supabase.from("payments").update({
        metadata: {
          ...meta,
          reconcile_attempts: attemptCount,
          last_reconcile_attempt_at: lastAttemptAt,
          last_reconcile_result: "viva_lookup_failed",
          last_reconcile_error: errMsg,
        },
      }).eq("id", p.id);
      await recordFailure(supabase, {
        user_id: p.user_id, payment_id: p.id, transaction_id: transactionId,
        order_code: orderCode, retry_count: attemptCount,
        error: `viva_lookup_failed: ${errMsg}`,
        payload: { transactionId, orderCode },
      });
      continue;
    }

    const newStatus = mapStatus(tx.statusId);
    if (newStatus === "pending") {
      summary.unchanged++;
      await supabase.from("payments").update({
        metadata: { ...meta, reconcile_attempts: attemptCount, last_reconcile_attempt_at: lastAttemptAt, last_reconcile_result: "still_pending" },
      }).eq("id", p.id);
      continue;
    }

    const eventTypeId = newStatus === "paid" ? 1796 : newStatus === "failed" ? 1797 : 1797;
    const syntheticPayload = {
      EventTypeId: eventTypeId,
      EventTypeName: newStatus === "paid" ? "TransactionPaymentCreated" : "TransactionFailed",
      EventId: `reconciliation_${tx.transactionId}_${newStatus}`,
      EventData: {
        TransactionId: tx.transactionId,
        OrderCode: tx.orderCode || orderCode,
        StatusId: tx.statusId,
      },
      _source: "reconciliation",
    };

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(syntheticPayload),
      });
      if (!res.ok) throw new Error(`webhook returned ${res.status}`);
      summary.updated++;
      summary.details.push({ payment_id: p.id, transaction_id: transactionId, viva_status: tx.statusId, mapped: newStatus, webhook_status: res.status });
    } catch (e) {
      summary.failed++;
      const errMsg = String((e as Error)?.message || e).slice(0, 500);
      console.error(`[viva-reconcile] self-invoke webhook failed for payment=${p.id}`, e);
      await supabase.from("payments").update({
        metadata: {
          ...meta,
          reconcile_attempts: attemptCount,
          last_reconcile_attempt_at: lastAttemptAt,
          last_reconcile_result: "webhook_invoke_failed",
          last_reconcile_error: errMsg,
        },
      }).eq("id", p.id);
      await recordFailure(supabase, {
        user_id: p.user_id, payment_id: p.id, transaction_id: transactionId,
        order_code: orderCode, retry_count: attemptCount,
        error: `webhook_invoke_failed: ${errMsg}`,
        payload: syntheticPayload,
      });
      }).eq("id", p.id);
    }
  }

  console.log(`[viva-reconcile] done`, summary);
  return summary;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // Allow GET for manual triggering / health check from the dashboard.
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }
  try {
    const summary = await reconcileOnce();
    return json({ ok: true, env: vivaEnv().api.includes("demo") ? "demo" : "live", ...summary });
  } catch (e) {
    console.error("[viva-reconcile] fatal", e);
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
