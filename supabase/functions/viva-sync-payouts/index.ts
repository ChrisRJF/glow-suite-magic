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
import { vivaEnv, getVivaAccessToken, isVivaConfigured } from "../_shared/viva.ts";

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

async function fetchSettlements(fromDate: string, toDate: string): Promise<VivaSettlementRow[]> {
  const env = vivaEnv();
  const token = await getVivaAccessToken();
  // Viva exposes settlement transactions via /acquiring/v1/transactions
  const url = `${env.api}/acquiring/v1/transactions?DateFrom=${fromDate}&DateTo=${toDate}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Viva settlements fetch failed (${res.status}): ${text.slice(0, 300)}`);
  }
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = {}; }
  const rows: VivaSettlementRow[] = Array.isArray(data) ? data
    : Array.isArray(data?.transactions) ? data.transactions
    : Array.isArray(data?.data) ? data.data
    : [];
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!isVivaConfigured()) return json({ error: "viva_not_configured" }, 400);

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

  // Resolve users to sync (only live merchants with viva payments)
  let users: { user_id: string }[] = [];
  if (targetUserId) {
    users = [{ user_id: targetUserId }];
  } else {
    const { data } = await supabase
      .from("payments")
      .select("user_id")
      .eq("provider", "viva")
      .eq("is_demo", false)
      .gte("created_at", fromDate.toISOString());
    const seen = new Set<string>();
    for (const r of data || []) {
      if (r.user_id && !seen.has(r.user_id)) { seen.add(r.user_id); users.push({ user_id: r.user_id }); }
    }
  }

  let settlements: VivaSettlementRow[] = [];
  try {
    settlements = await fetchSettlements(fmt(fromDate), fmt(toDate));
  } catch (e) {
    console.error("[viva-sync-payouts] fetch failed", e);
    return json({ error: String((e as Error).message || e) }, 502);
  }

  let totalPayouts = 0;
  let totalTx = 0;
  let mismatches = 0;

  for (const u of users) {
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
          merchant_id: Deno.env.get("VIVA_MERCHANT_ID") || null,
          source_code: Deno.env.get("VIVA_SOURCE_CODE") || null,
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
