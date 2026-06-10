// Poll the status of a Viva Cloud Terminal payment session.
// POST /functions/v1/viva-terminal-payment-status  { payment_id }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { vivaPosEnv, getVivaPosAccessToken, isVivaPosConfigured } from "../_shared/viva.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const TERMINAL_STATES = new Set(["paid", "failed", "cancelled", "expired"]);

function findStringValue(payload: any, keys: string[]): string | null {
  if (!payload || typeof payload !== "object") return null;
  const queue = [payload];
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== "object") continue;
    for (const key of keys) {
      const value = item[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value);
    }
    for (const value of Object.values(item)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

function classifyVivaPollResponse(providerData: any) {
  const transactionId = findStringValue(providerData, ["transactionId", "TransactionId", "transactionID", "TransactionID"]);
  const rawStatus = findStringValue(providerData, [
    "statusId", "StatusId", "status", "Status", "state", "State",
    "transactionStatus", "TransactionStatus", "paymentStatus", "PaymentStatus",
    "responseEventId", "eventId", "EventId",
  ]) || (providerData?.success !== undefined ? `success:${String(providerData.success)}` : null);
  const statusIdRaw = String(providerData?.statusId ?? providerData?.StatusId ?? "").toUpperCase();
  const success = providerData?.success ?? providerData?.Success;
  const blob = JSON.stringify(providerData || {});
  const looksCancelled = /\b(cancelled|canceled|cancel)\b/i.test(blob) || statusIdRaw === "X";
  const looksExpired = /\b(expired|timeout|timed out)\b/i.test(blob);
  const looksFailed = /\b(failed|declined|rejected|unsuccessful|not approved)\b/i.test(blob) || statusIdRaw === "E";
  const looksPaid = !looksCancelled && !looksExpired && !looksFailed && (
    statusIdRaw === "F" || /\b(approved|paid|completed|captured|transaction approved)\b/i.test(blob) || (success === true && !!transactionId)
  );
  const newStatus = looksPaid ? "paid" : looksCancelled ? "cancelled" : looksExpired ? "expired" : looksFailed ? "failed" : null;
  return { transactionId, rawStatus, newStatus };
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

    const { payment_id } = await req.json().catch(() => ({}));
    if (!payment_id) return json({ error: "payment_id_required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: payment, error } = await admin
      .from("payments")
      .select("*")
      .eq("id", payment_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return json({ error: "lookup_failed", detail: error.message }, 500);
    if (!payment) return json({ error: "not_found" }, 404);
    if (payment.method !== "terminal" || payment.provider !== "viva") {
      return json({ error: "not_a_terminal_payment" }, 400);
    }

    // If already terminal, return as-is (idempotent)
    if (payment.status === "paid") return json({ payment_id, status: "paid", terminal_status: "paid", paid_at: payment.paid_at });
    if (TERMINAL_STATES.has(payment.status)) return json({ payment_id, status: payment.status, terminal_status: payment.status });

    const meta = (payment.metadata || {}) as Record<string, any>;
    const sessionId = meta.session_id || payment.checkout_reference;
    const terminalId = meta.terminal_id;
    if (!sessionId || !terminalId) return json({ error: "missing_session_info" }, 400);

    let newStatus: string | null = null;
    let providerData: any = null;
    let providerError: string | null = null;
    let rawStatus: string | null = null;
    let txStr: string | null = null;

    if (isVivaPosConfigured()) {
      try {
        const { token, kind } = await getVivaPosAccessToken();
        const env = vivaPosEnv();
        const url = `${env.api}/ecr/v1/sessions/${sessionId}?terminalId=${encodeURIComponent(terminalId)}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const text = await res.text();
        try { providerData = JSON.parse(text); } catch { providerData = { raw: text }; }
        const classified = classifyVivaPollResponse(providerData);
        rawStatus = classified.rawStatus;
        txStr = classified.transactionId;
        console.log("[viva-terminal-payment-status] poll response", JSON.stringify({
          payment_id,
          sessionId,
          transactionId: txStr,
          raw_status: rawStatus,
          raw_response: providerData,
          http_status: res.status,
          credential_kind: kind,
        }));
        if (res.status === 404) {
          // session not yet known to terminal — keep pending
        } else if (!res.ok) {
          providerError = `viva_status_http_${res.status}: ${text.slice(0, 300)}`;
        } else {
          newStatus = classified.newStatus;
        }
      } catch (e) {
        providerError = `viva_status_exception: ${(e as Error).message}`;
      }
    } else {
      providerError = "viva_pos_not_configured";
    }

    if (newStatus && payment.status !== "paid") {
      const nowIso = new Date().toISOString();
      if (newStatus === "paid") {
        console.log("[viva-terminal-payment-status] failure_point", JSON.stringify({
          point: "B_polling_received_approved",
          payment_id: payment.id,
          sessionId,
          transactionId: txStr,
          raw_status: rawStatus,
          raw_response: providerData,
        }));
      }
      const updates: Record<string, any> = {
        status: newStatus,
        last_status_sync_at: nowIso,
        metadata: {
          ...meta,
          terminal_status: newStatus,
          provider_status_payload: providerData,
          raw_status: rawStatus,
          viva_transaction_id: txStr || meta.viva_transaction_id || null,
          last_status_sync_at: nowIso,
        },
      };
      if (newStatus === "paid") updates.paid_at = nowIso;
      if (newStatus === "failed" || newStatus === "cancelled" || newStatus === "expired") {
        updates.failure_reason = providerData?.message || providerData?.errorText || newStatus;
      }
      const { data: updatedPayment, error: updErr } = await admin
        .from("payments")
        .update(updates)
        .eq("id", payment.id)
        .neq("status", "paid")
        .select("id,status")
        .maybeSingle();
      if (updErr) {
        console.error("[viva-terminal-payment-status] failure_point", JSON.stringify({
          point: "E_database_update_failed",
          payment_id: payment.id,
          sessionId,
          transactionId: txStr,
          raw_status: rawStatus,
          target_status: newStatus,
          error: updErr.message,
        }));
      } else if (updatedPayment) {
        const { error: histErr } = await admin.from("payment_status_history").insert({
          payment_id: payment.id,
          old_status: payment.status,
          new_status: newStatus,
          source: "poll",
        });
        if (histErr) console.error("[viva-terminal-payment-status] audit insert failed", histErr);
        console.log("[viva-terminal-payment-status] failure_point", JSON.stringify({
          point: newStatus === "paid" ? "poll_approved_persisted_paid" : "poll_terminal_status_persisted",
          payment_id: payment.id,
          sessionId,
          transactionId: txStr,
          raw_status: rawStatus,
          from: payment.status,
          to: newStatus,
        }));
      } else {
        console.log("[viva-terminal-payment-status] failure_point", JSON.stringify({
          point: "poll_update_noop_already_terminal",
          payment_id: payment.id,
          sessionId,
          transactionId: txStr,
          raw_status: rawStatus,
          target_status: newStatus,
        }));
      }

      // Sync appointment payment_status only after the payment row update succeeds.
      if (!updErr && updatedPayment && payment.appointment_id) {
        const apptUpd: Record<string, any> = {};
        if (newStatus === "paid") apptUpd.payment_status = "paid";
        else if (newStatus === "failed" || newStatus === "cancelled" || newStatus === "expired") apptUpd.payment_status = "unpaid";
        if (Object.keys(apptUpd).length) {
          await admin.from("appointments").update(apptUpd).eq("id", payment.appointment_id).eq("user_id", userId);
        }
      }

      console.log(`[viva-terminal-payment-status] ${payment.id} -> ${newStatus}`);
    } else if (providerError) {
      console.warn("[viva-terminal-payment-status] failure_point", JSON.stringify({
        point: "A_viva_poll_error_no_approved_status",
        payment_id: payment.id,
        sessionId,
        transactionId: txStr,
        raw_status: rawStatus,
        error: providerError,
      }));
    } else if (txStr && txStr !== meta.viva_transaction_id) {
      // Even while pending, persist transactionId so viva-webhook can match it.
      await admin
        .from("payments")
        .update({
          last_status_sync_at: new Date().toISOString(),
          metadata: { ...meta, viva_transaction_id: txStr, last_status_sync_at: new Date().toISOString() },
        })
        .eq("id", payment.id)
        .neq("status", "paid");
      console.log("[viva-terminal-payment-status] failure_point", JSON.stringify({
        point: "A_viva_transaction_seen_but_not_approved_yet",
        payment_id: payment.id,
        sessionId,
        transactionId: txStr,
        raw_status: rawStatus,
      }));
    } else if (!newStatus) {
      console.log("[viva-terminal-payment-status] failure_point", JSON.stringify({
        point: "A_viva_never_returned_approved_yet",
        payment_id: payment.id,
        sessionId,
        transactionId: txStr,
        raw_status: rawStatus,
      }));
    }

    return json({
      payment_id,
      status: newStatus || payment.status,
      terminal_status: newStatus || meta.terminal_status || "pending",
      viva_transaction_id: txStr || meta.viva_transaction_id || null,
      provider_error: providerError,
    });
  } catch (e) {
    console.error("[viva-terminal-payment-status] error", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
