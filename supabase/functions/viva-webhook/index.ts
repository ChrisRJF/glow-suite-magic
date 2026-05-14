// Viva Smart Checkout webhook.
// Source of truth for inbound Viva events. Stores every payload in the
// viva_webhook_events ledger BEFORE side-effects so duplicates and
// failures are recoverable. Returns 2xx fast.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getVivaTransaction } from "../_shared/viva.ts";
import { diagnosticCorsHeaders, okText, parseVivaPayload, writeWebhookDebugLog } from "../_shared/vivaDiagnostics.ts";

const corsHeaders = diagnosticCorsHeaders;

// Temporary Viva webhook onboarding diagnostics.
// curl GET: curl -i "https://ueqhckkuuwdsrjrdczbb.supabase.co/functions/v1/viva-webhook?check=1"
// curl POST json: curl -i -X POST "https://ueqhckkuuwdsrjrdczbb.supabase.co/functions/v1/viva-webhook" -H "Content-Type: application/json" --data '{"EventTypeId":1796,"EventData":{"OrderCode":"test","StatusId":"F"}}'
// curl POST form: curl -i -X POST "https://ueqhckkuuwdsrjrdczbb.supabase.co/functions/v1/viva-webhook" -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode 'EventTypeId=1796' --data-urlencode 'EventData={"OrderCode":"test","StatusId":"F"}'

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 48) || "salon";
}

function mapVivaStatus(statusId: string, eventTypeId?: number): "paid" | "failed" | "expired" | "cancelled" | "pending" | "refunded" {
  if (eventTypeId === 1798 || eventTypeId === 1799) return "refunded";
  if (statusId === "F" || eventTypeId === 1796) return "paid";
  if (eventTypeId === 1797 || statusId === "E") return "failed";
  if (statusId === "X") return "cancelled";
  return "pending";
}

// Allowed payment status transitions (idempotent state machine).
const TERMINAL = new Set(["paid", "refunded", "partially_refunded"]);
function canTransition(from: string, to: string): boolean {
  if (from === to) return false; // no-op
  if (from === "pending") return ["paid", "failed", "cancelled", "expired"].includes(to);
  if (from === "paid") return ["refunded", "partially_refunded"].includes(to);
  // Never demote a paid/refunded payment back to failed
  return false;
}

async function sendWhiteLabelEmail(supabase: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const { error } = await supabase.functions.invoke("send-white-label-email", { body });
  if (error) console.error("White-label email failed", error.message);
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const method = req.method;
  const contentType = req.headers.get("content-type") || "";
  let rawBody = "";
  try {
    rawBody = await req.clone().text();
    await writeWebhookDebugLog(supabase, req, rawBody, "viva-webhook");
  } catch (diagErr) {
    console.error("[viva-webhook] diagnostics failed", diagErr);
  }

  console.log("[viva-webhook] method:", method, "ua:", req.headers.get("user-agent") || "", "content-type:", contentType);

  if (["OPTIONS", "GET", "HEAD"].includes(method)) {
    console.log("[viva-webhook] verification ping", method);
    return okText();
  }
  if (method !== "POST") return okText();

  let payload: Record<string, unknown> = {};
  try {
    payload = parseVivaPayload(contentType, rawBody);
  } catch (parseErr) {
    console.warn("[viva-webhook] payload parse failed", parseErr);
    // keep payload empty
  }

  const p: any = payload;
  let eventData = p?.EventData || p?.eventData || p || {};
  if (typeof eventData === "string") {
    try { eventData = JSON.parse(eventData); } catch { eventData = {}; }
  }
  const eventTypeId = Number(p?.EventTypeId ?? p?.eventTypeId ?? 0) || null;
  const eventId = p?.EventId != null ? String(p.EventId) : (p?.eventId != null ? String(p.eventId) : null);
  const transactionId = String(eventData?.TransactionId ?? eventData?.transactionId ?? "") || null;
  const orderCodeRaw = eventData?.OrderCode ?? eventData?.orderCode;
  const orderCode = orderCodeRaw != null ? String(orderCodeRaw) : null;
  const statusId = String(eventData?.StatusId ?? eventData?.statusId ?? "") || null;
  const status = mapVivaStatus(statusId || "", eventTypeId || undefined);
  const eventTypeName = String(p?.EventTypeName || p?.eventTypeName || (eventTypeId ? `event_${eventTypeId}` : "unknown"));
  const eventSource: "webhook" | "redirect_fallback" | "reconciliation" =
    p?._source === "redirect_fallback" ? "redirect_fallback"
    : p?._source === "reconciliation" ? "reconciliation"
    : "webhook";

  console.log("[viva-webhook] event:", eventTypeId, eventTypeName, "tx:", transactionId, "orderCode:", orderCode, "status:", status);

  // ---- Webhook security checks (non-breaking) ----
  // 1. Optional signature header check vs VIVA_WEBHOOK_KEY secret.
  // 2. Replay protection: event timestamp older than 24h is suspicious.
  // 3. Unknown event with no identifiers is suspicious.
  const sigHeader = req.headers.get("viva-signature") || req.headers.get("x-viva-signature") || req.headers.get("x-signature") || null;
  const expectedKey = Deno.env.get("VIVA_WEBHOOK_KEY") || null;
  let signatureValid: boolean | null = null;
  if (sigHeader && expectedKey) signatureValid = sigHeader.trim() === expectedKey.trim();
  else if (expectedKey) signatureValid = null; // Viva rarely sends explicit signature header; do not reject

  let suspicious = false;
  const suspiciousReasons: string[] = [];
  if (sigHeader && expectedKey && signatureValid === false) {
    suspicious = true; suspiciousReasons.push("invalid_signature");
  }
  const eventTimestampRaw = (p?.Created || p?.created || (eventData as any)?.InsDate || (eventData as any)?.insDate || null) as string | null;
  if (eventTimestampRaw) {
    const ts = Date.parse(String(eventTimestampRaw));
    if (Number.isFinite(ts) && Date.now() - ts > 24 * 60 * 60 * 1000) {
      suspicious = true; suspiciousReasons.push("replay_or_stale_event");
    }
  }
  if (!eventTypeId && !transactionId && !orderCode && rawBody.trim().length > 0) {
    suspicious = true; suspiciousReasons.push("unrecognized_payload");
  }
  if (suspicious) {
    console.warn("[viva-webhook] suspicious request", JSON.stringify({
      reasons: suspiciousReasons,
      ua: req.headers.get("user-agent") || null,
      has_sig: !!sigHeader,
    }));
  }

  // STEP 1 — write ledger FIRST (idempotent via unique indexes).
  let ledgerId: string | null = null;
  {
    const { data: inserted, error: insErr } = await supabase
      .from("viva_webhook_events")
      .insert({
        event_id: eventId,
        event_type: eventTypeName,
        event_type_id: eventTypeId,
        order_code: orderCode,
        transaction_id: transactionId,
        status,
        source: eventSource,
        raw_payload: payload as any,
        signature_valid: signatureValid,
        suspicious,
        suspicious_reason: suspicious ? suspiciousReasons.join(",") : null,
      })
      .select("id")
      .maybeSingle();
    if (insErr) {
      // Duplicate (unique violation) -> still ack 200 so Viva stops retrying.
      const msg = String(insErr.message || "");
      if (msg.includes("duplicate") || (insErr as any).code === "23505") {
        console.log("[viva-webhook] duplicate event ignored");
        return okText();
      }
      console.error("[viva-webhook] ledger insert failed", insErr);
      // Still try to process — but ack regardless to avoid Viva retry storms.
    } else {
      ledgerId = inserted?.id ?? null;
    }
      console.error("[viva-webhook] ledger insert failed", insErr);
      // Still try to process — but ack regardless to avoid Viva retry storms.
    } else {
      ledgerId = inserted?.id ?? null;
    }
  }

  if (!transactionId && !orderCode) {
    if (ledgerId) {
      await supabase.from("viva_webhook_events")
        .update({ error: "malformed_or_empty_payload", processed: true, processed_at: new Date().toISOString() })
        .eq("id", ledgerId);
    }
    return okText();
  }

  try {
    // Locate payment by orderCode or stored transactionId.
    let payment: any = null;
    if (orderCode) {
      const { data } = await supabase
        .from("payments")
        .select("*")
        .or(`mollie_payment_id.eq.${orderCode},checkout_reference.eq.${orderCode}`)
        .eq("provider", "viva")
        .limit(1)
        .maybeSingle();
      payment = data;
    }
    if (!payment && transactionId) {
      const { data } = await supabase
        .from("payments")
        .select("*")
        .contains("metadata", { viva_transaction_id: transactionId })
        .limit(1)
        .maybeSingle();
      payment = data;
    }

    if (!payment) {
      if (ledgerId) {
        await supabase.from("viva_webhook_events")
          .update({ error: "payment_not_found", processed: false })
          .eq("id", ledgerId);
      }
      return okText();
    }

    // Tag ledger with user/payment for merchant isolation.
    if (ledgerId) {
      await supabase.from("viva_webhook_events").update({
        user_id: payment.user_id,
        is_demo: !!payment.is_demo,
        payment_id: payment.id,
      }).eq("id", ledgerId);
    }

    if (payment.is_demo) {
      if (ledgerId) await supabase.from("viva_webhook_events").update({ processed: true, processed_at: new Date().toISOString() }).eq("id", ledgerId);
      return okText();
    }

    // Authoritative status via Viva API when possible.
    let resolvedOrderCode = orderCode || (payment.metadata as any)?.viva_order_code || null;
    let providerFeeCents: number | null = null;
    let txAmountCents: number | null = null;
    let resolvedStatus = status;
    if (transactionId) {
      try {
        const tx = await getVivaTransaction(transactionId);
        resolvedStatus = mapVivaStatus(tx.statusId, eventTypeId || undefined);
        resolvedOrderCode = resolvedOrderCode || tx.orderCode;
        txAmountCents = tx.amount;
        // tx.totalFee not in shared helper; attempt via raw json
        const txAny = tx as any;
        if (typeof txAny.totalFee === "number") providerFeeCents = Math.round(txAny.totalFee * 100);
      } catch (e) {
        console.warn("Viva tx lookup failed", e);
      }
    }

    // Idempotent state machine guard.
    const currentStatus = String(payment.status || "pending");
    const targetStatus = resolvedStatus === "refunded" ? "refunded" : resolvedStatus;
    if (!canTransition(currentStatus, targetStatus)) {
      if (ledgerId) await supabase.from("viva_webhook_events").update({ processed: true, processed_at: new Date().toISOString(), error: `noop_${currentStatus}_${targetStatus}` }).eq("id", ledgerId);
      return okText();
    }

    const isPaid = targetStatus === "paid";
    const isFailed = ["failed", "expired", "cancelled"].includes(targetStatus);
    const isRefund = targetStatus === "refunded";

    // Build merged metadata. Fees stored once (only when first paid).
    const existingMeta = (payment.metadata as any) || {};
    const feeAlreadyStored = existingMeta.platform_fee_cents != null || existingMeta.glowpay_margin_cents != null;
    const metaUpdates: Record<string, unknown> = {
      ...existingMeta,
      viva_order_code: resolvedOrderCode,
      viva_transaction_id: transactionId || existingMeta.viva_transaction_id || null,
      viva_status_id: statusId || existingMeta.viva_status_id || null,
      viva_event_type_id: eventTypeId || existingMeta.viva_event_type_id || null,
      viva_source_code: existingMeta.viva_source_code || Deno.env.get("VIVA_SOURCE_CODE") || null,
    };
    if (isPaid && !feeAlreadyStored) {
      metaUpdates.platform_fee_cents = 0;
      metaUpdates.glowpay_margin_cents = 0;
      if (providerFeeCents != null) metaUpdates.provider_fee_cents = providerFeeCents;
    }

    const nowIso = new Date().toISOString();
    await supabase
      .from("payments")
      .update({
        status: targetStatus,
        paid_at: isPaid ? nowIso : payment.paid_at,
        refunded_at: isRefund ? nowIso : (payment as any).refunded_at ?? null,
        webhook_received_at: nowIso,
        last_status_sync_at: nowIso,
        failure_reason: isFailed ? targetStatus : payment.failure_reason,
        metadata: metaUpdates,
      })
      .eq("id", payment.id);

    // Structured audit logs (do not confirm bookings on failure; preserve payment row on refund).
    if (isFailed) {
      console.log("viva_failed_payment_processed", JSON.stringify({
        payment_id: payment.id, user_id: payment.user_id, order_code: resolvedOrderCode,
        transaction_id: transactionId, from: currentStatus, to: targetStatus, source: eventSource,
      }));
    }
    if (isRefund) {
      console.log("viva_refund_processed", JSON.stringify({
        payment_id: payment.id, user_id: payment.user_id, order_code: resolvedOrderCode,
        transaction_id: transactionId, refunded_at: nowIso, source: eventSource,
      }));
    }
    console.log("viva_status_updated", JSON.stringify({
      payment_id: payment.id, from: currentStatus, to: targetStatus,
      event_type_id: eventTypeId, event_type: eventTypeName, source: eventSource,
    }));

    const arSources = ["auto_revenue", "auto_revenue_deposit", "auto_revenue_full"];
    const isAutoRevenue = arSources.includes(existingMeta?.source);
    const appointmentId = payment.appointment_id || existingMeta?.appointment_id || null;

    if (appointmentId && !isRefund) {
      const amountPaid = isPaid ? Number(payment.amount || 0) : 0;
      const apptStatus = isAutoRevenue && isPaid ? "gepland"
        : isAutoRevenue && isFailed ? "geannuleerd"
        : isPaid ? "confirmed"
        : "pending_confirmation";
      const apptPaymentStatus = isPaid ? "paid" : isFailed ? "payment_failed" : "pending";

      const updatePayload: Record<string, unknown> = {
        payment_status: apptPaymentStatus,
        status: apptStatus,
        amount_paid: amountPaid,
      };
      if (isAutoRevenue && isPaid) updatePayload.payment_expires_at = null;

      const { data: appointment } = await supabase.from("appointments").select("booking_group_id").eq("id", appointmentId).maybeSingle();
      if (appointment?.booking_group_id) {
        await supabase.from("appointments").update(updatePayload).eq("booking_group_id", appointment.booking_group_id);
      }
      await supabase.from("appointments").update(updatePayload).eq("id", appointmentId);

      if (isAutoRevenue) {
        const offerId = existingMeta?.offer_id;
        if (offerId) {
          const offerStatus = isPaid ? "paid" : isFailed ? "expired" : "pending_payment";
          await supabase
            .from("auto_revenue_offers")
            .update({ status: offerStatus, updated_at: new Date().toISOString() })
            .eq("id", offerId)
            .neq("status", offerStatus);
        }
      }
    }

    const membershipId = payment.membership_id || existingMeta?.membership_id;
    if (membershipId && !isRefund) {
      const membershipStatus = isPaid ? "active" : isFailed ? "payment_issue" : "active";
      await supabase.from("customer_memberships").update({
        status: membershipStatus,
        last_payment_status: isPaid ? "paid" : isFailed ? "failed" : "open",
        next_payment_at: isPaid ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
        failure_reason: isFailed ? targetStatus : null,
        updated_at: new Date().toISOString(),
      }).eq("id", membershipId).eq("user_id", payment.user_id);
    }

    if (isPaid) {
      const { data: settings } = await supabase.from("settings").select("salon_name, public_slug").eq("user_id", payment.user_id).eq("is_demo", false).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const { data: customer } = payment.customer_id
        ? await supabase.from("customers").select("name, email, phone").eq("id", payment.customer_id).eq("user_id", payment.user_id).maybeSingle()
        : { data: null };

      if (customer?.email) {
        await sendWhiteLabelEmail(supabase, {
          user_id: payment.user_id,
          salon_slug: settings?.public_slug || slugify(settings?.salon_name || "salon"),
          salon_name: settings?.salon_name || "Salon",
          recipient_email: customer.email,
          recipient_name: customer.name || "",
          template_key: payment.membership_id ? "membership_notification" : "payment_receipt",
          idempotency_key: `viva-payment-${payment.id}-paid`,
          template_data: {
            customer_name: customer.name,
            amount: payment.amount,
            method: "viva",
            reference: resolvedOrderCode || payment.id,
            status: "Actief",
          },
        });
      }

      if (appointmentId && customer?.phone) {
        try {
          const { data: waSettings } = await supabase
            .from("whatsapp_settings")
            .select("enabled, send_booking_confirmation")
            .eq("user_id", payment.user_id)
            .maybeSingle();
          if (waSettings?.enabled && waSettings?.send_booking_confirmation) {
            const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-send`;
            fetch(fnUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
              body: JSON.stringify({
                user_id: payment.user_id,
                to: customer.phone,
                message: isAutoRevenue ? "Je afspraak staat vast! 🙌 Tot dan." : "Bedankt voor je betaling — je afspraak is bevestigd.",
                customer_id: payment.customer_id,
                appointment_id: appointmentId,
                kind: "confirmation",
                meta: { trigger: "viva_payment_paid" },
              }),
            }).catch((e) => console.error("WhatsApp send (viva webhook) failed", e));
          }
        } catch (waErr) {
          console.error("WhatsApp dispatch (viva webhook) error", waErr);
        }
      }
    }

    if (ledgerId) {
      await supabase.from("viva_webhook_events")
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq("id", ledgerId);
    }

    return okText();
  } catch (error) {
    console.error("viva-webhook processing error", error);
    if (ledgerId) {
      await supabase.from("viva_webhook_events")
        .update({ error: String((error as Error).message || error), retry_count: 1 })
        .eq("id", ledgerId);
    }
    // Always 200 so Viva does not hammer retries; ledger captures the failure.
    return okText();
  }
});
