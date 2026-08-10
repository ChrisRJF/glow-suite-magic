// viva-sync-payouts
// Lightweight payout reconciliation foundation.
// Fetches Viva settlement transactions and stores them per-salon in
// viva_payouts + viva_payout_transactions, then matches them against
// existing payments and flags mismatches.
//
// Idempotent (unique on user_id + payout_id and user_id + payout_id + viva_transaction_id).
// Demo/live isolation: only syncs against live (non-demo) payments.
//
// Invocation:
//   POST /functions/v1/viva-sync-payouts            -> sync all eligible salons
//   POST /functions/v1/viva-sync-payouts            { user_id: "..." } -> single salon
//
// Does NOT touch Mollie, bookings, appointments, redirect fallback or reconcile cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  getIsvSettlements,
  hasResellerBasicCredentials,
  isvWarn,
  maskId,
} from "../_shared/vivaIsv.ts";

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

interface VivaSettlementRow {
  transactionId?: string;
  orderCode?: string | number;
  settlementId?: string;
  settlementDate?: string;
  amount?: number;       // gross
  totalFee?: number;     // viva fee
  netAmount?: number;
  currencyCode?: string;
  insDate?: string;
  statusId?: string;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Payout retrieval is merchant scoped and requires the reseller Basic-auth
  // credentials. Without them we refuse rather than fall back to a single
  // platform merchant dataset (that would leak data across salons).
  if (!hasResellerBasicCredentials()) {
    return json({ error: "reseller_credentials_missing" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const targetUserId: string | null = body?.user_id || null;
  const days = Math.min(Math.max(Number(body?.days) || 7, 1), 31);
  const toDate = new Date();
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  // Resolve merchants to sync. The merchant mapping is the only source of
  // truth: one connected merchant -> exactly one salon (user_id).
  let mq = supabase
    .from("glowpay_connected_merchants")
    .select("user_id, viva_merchant_id, viva_source_code")
    .eq("is_demo", false)
    .not("viva_merchant_id", "is", null);
  if (targetUserId) mq = mq.eq("user_id", targetUserId);
  const { data: merchants } = await mq;

  const targets = (merchants || []).filter((m: any) => m.user_id && m.viva_merchant_id);
  if (targets.length === 0) return json({ ok: true, users_synced: 0, payouts_upserted: 0, transactions_upserted: 0, mismatches: 0 });

  let totalPayouts = 0;
  let totalTx = 0;
  let mismatches = 0;
  const failedMerchants: string[] = [];

  for (const m of targets as any[]) {
    const u = { user_id: m.user_id as string };
    const merchantId = String(m.viva_merchant_id);

    // Merchant-scoped retrieval: rows returned here belong to this merchant only.
    let settlements: VivaSettlementRow[] = [];
    try {
      settlements = await getIsvSettlements(merchantId, fmt(fromDate), fmt(toDate)) as VivaSettlementRow[];
    } catch (e) {
      isvWarn("settlement_fetch_failed", {
        fn: "viva-sync-payouts",
        user_id: u.user_id,
        merchant_id: maskId(merchantId),
        message: String((e as Error)?.message || "error"),
      });
      failedMerchants.push(maskId(merchantId));
      continue;
    }

    // Group settlements by settlementId (one payout per settlement)
    const byPayout = new Map<string, VivaSettlementRow[]>();
    for (const row of settlements) {
      const pid = String(row.settlementId || row.settlementDate || "unknown");
      if (!byPayout.has(pid)) byPayout.set(pid, []);
      byPayout.get(pid)!.push(row);
    }

    for (const [payoutId, rows] of byPayout) {
      const gross = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
      const fee = rows.reduce((s, r) => s + Number(r.totalFee || 0), 0);
      const net = rows.reduce((s, r) => s + Number(r.netAmount ?? (Number(r.amount || 0) - Number(r.totalFee || 0))), 0);
      const payoutDate = rows[0]?.settlementDate?.slice(0, 10) || null;

      const { data: payoutRow, error: pErr } = await supabase
        .from("viva_payouts")
        .upsert({
          user_id: u.user_id,
          is_demo: false,
          payout_id: payoutId,
          merchant_id: merchantId,
          source_code: m.viva_source_code || null,

          gross_amount: gross.toFixed(2),
          fee_amount: fee.toFixed(2),
          net_amount: net.toFixed(2),
          currency: rows[0]?.currencyCode || "EUR",
          payout_date: payoutDate,
          payout_status: "settled",
          raw_payload: { rows: rows.length },
          synced_at: new Date().toISOString(),
        }, { onConflict: "user_id,payout_id" })
        .select("id")
        .maybeSingle();

      if (pErr) { console.error("[viva-sync-payouts] payout upsert", pErr.message); continue; }
      totalPayouts++;
      const payoutRowId = payoutRow?.id;
      if (!payoutRowId) continue;

      let payoutMismatch = false;
      const mismatchReasons: string[] = [];

      for (const r of rows) {
        const txId = r.transactionId ? String(r.transactionId) : null;
        if (!txId) continue;

        // Match against existing payment
        const { data: payment } = await supabase
          .from("payments")
          .select("id, amount, status")
          .eq("user_id", u.user_id)
          .eq("provider", "viva")
          .eq("is_demo", false)
          .contains("metadata", { viva_transaction_id: txId })
          .maybeSingle();

        let matched = !!payment;
        let mismatchReason: string | null = null;
        if (payment) {
          const expectedCents = Math.round(Number(payment.amount) * 100);
          const actualCents = Math.round(Number(r.amount || 0) * 100);
          if (expectedCents !== actualCents) {
            matched = false;
            mismatchReason = `amount_mismatch:${expectedCents}_vs_${actualCents}`;
          }
        } else {
          mismatchReason = "payment_not_found";
        }
        if (!matched) { payoutMismatch = true; mismatches++; mismatchReasons.push(`${txId}:${mismatchReason}`); }

        const { error: txErr } = await supabase
          .from("viva_payout_transactions")
          .upsert({
            user_id: u.user_id,
            is_demo: false,
            payout_id: payoutRowId,
            payment_id: payment?.id || null,
            viva_transaction_id: txId,
            viva_order_code: r.orderCode != null ? String(r.orderCode) : null,
            gross_amount: Number(r.amount || 0).toFixed(2),
            fee_amount: Number(r.totalFee || 0).toFixed(2),
            net_amount: Number(r.netAmount ?? (Number(r.amount || 0) - Number(r.totalFee || 0))).toFixed(2),
            currency: r.currencyCode || "EUR",
            transaction_date: r.insDate || null,
            matched,
            mismatch_reason: mismatchReason,
            raw_payload: r as any,
          }, { onConflict: "user_id,payout_id,viva_transaction_id" });
        if (txErr) console.error("[viva-sync-payouts] tx upsert", txErr.message);
        else totalTx++;
      }

      if (payoutMismatch) {
        await supabase.from("viva_payouts").update({
          mismatch: true,
          mismatch_reason: mismatchReasons.slice(0, 5).join("; "),
        }).eq("id", payoutRowId);
        console.warn("viva_payout_mismatch", JSON.stringify({ user_id: u.user_id, payout_id: payoutId, mismatches: mismatchReasons.length }));
      }
    }
  }

  return json({
    ok: true,
    users_synced: users.length,
    payouts_upserted: totalPayouts,
    transactions_upserted: totalTx,
    mismatches,
    range: { from: fmt(fromDate), to: fmt(toDate) },
  });
});
