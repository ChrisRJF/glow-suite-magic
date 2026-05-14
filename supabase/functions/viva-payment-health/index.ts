// Public health probe for the Viva payment pipeline.
// GET /functions/v1/viva-payment-health
// Returns aggregate signals for monitoring & banner rendering.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = Date.now();
    const fifteenMinAgo = new Date(now - 15 * 60 * 1000).toISOString();
    const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString();
    const [
      lastWebhook, lastReconcile, pendingOld, failedSyncs, hasViva, dlqCount,
      suspiciousCount, lastSuspicious, lastPayout, payoutMismatchCount,
      terminalsActive, lastTerminalPayment, failedTerminalPayments, pendingTerminalOld,
    ] = await Promise.all([
      supabase.from("viva_webhook_events").select("created_at").eq("source", "webhook").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("viva_webhook_events").select("created_at").eq("source", "reconciliation").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("payments").select("id", { count: "exact", head: true }).eq("provider", "viva").eq("is_demo", false).in("status", ["pending", "open", "processing"]).lt("created_at", tenMinAgo),
      supabase.from("viva_webhook_events").select("id", { count: "exact", head: true }).not("error", "is", null).gte("created_at", dayAgo),
      supabase.from("payments").select("id", { count: "exact", head: true }).eq("provider", "viva").eq("is_demo", false),
      supabase.from("viva_dead_letter_queue").select("id", { count: "exact", head: true }).is("resolved_at", null),
      supabase.from("viva_webhook_events").select("id", { count: "exact", head: true }).eq("suspicious", true).gte("created_at", dayAgo),
      supabase.from("viva_webhook_events").select("created_at").eq("suspicious", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("viva_payouts").select("synced_at").order("synced_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("viva_payouts").select("id", { count: "exact", head: true }).eq("mismatch", true),
      supabase.from("viva_terminals").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("payments").select("created_at").eq("provider", "viva").eq("method", "terminal").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("payments").select("id", { count: "exact", head: true }).eq("provider", "viva").eq("method", "terminal").in("status", ["failed", "cancelled", "expired"]).gte("created_at", dayAgo),
      supabase.from("payments").select("id", { count: "exact", head: true }).eq("provider", "viva").eq("method", "terminal").eq("status", "pending").lt("created_at", fiveMinAgo),
    ]);

    const lastWebhookAt = (lastWebhook.data as any)?.created_at || null;
    const lastReconcileAt = (lastReconcile.data as any)?.created_at || null;
    const pendingCount = (pendingOld as any)?.count || 0;
    const failedCount = (failedSyncs as any)?.count || 0;
    const dlq = (dlqCount as any)?.count || 0;
    const hasVivaPayments = ((hasViva as any)?.count || 0) > 0;
    const suspicious24h = (suspiciousCount as any)?.count || 0;
    const lastSuspiciousAt = (lastSuspicious.data as any)?.created_at || null;
    const lastPayoutSyncAt = (lastPayout.data as any)?.synced_at || null;
    const payoutMismatches = (payoutMismatchCount as any)?.count || 0;

    const webhookOk = !hasVivaPayments || (lastWebhookAt && new Date(lastWebhookAt).getTime() > now - 15 * 60 * 1000);
    const reconcileOk = !lastReconcileAt || new Date(lastReconcileAt).getTime() > now - 30 * 60 * 1000;

    return json({
      webhook_ok: !!webhookOk,
      reconcile_ok: !!reconcileOk,
      last_webhook_at: lastWebhookAt,
      last_reconcile_at: lastReconcileAt,
      pending_count: pendingCount,
      failed_syncs: failedCount,
      dead_letter_count: dlq,
      has_viva_payments: hasVivaPayments,
      webhook_security_warnings: suspicious24h,
      suspicious_request_count: suspicious24h,
      last_suspicious_attempt_at: lastSuspiciousAt,
      last_payout_sync_at: lastPayoutSyncAt,
      payout_mismatch_count: payoutMismatches,
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[viva-payment-health] error", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
