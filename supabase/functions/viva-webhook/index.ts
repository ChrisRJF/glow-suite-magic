// Viva Smart Checkout webhook.
// Handles Transaction Payment Created (1796) and Transaction Failed (1797).
// Mirrors mollie-webhook behaviour: updates payments, appointments, auto_revenue_offers, memberships
// and triggers WhatsApp confirmation on paid.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getVivaTransaction } from "../_shared/viva.ts";

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

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 48) || "salon";
}

function mapVivaStatus(statusId: string, eventTypeId?: number): "paid" | "failed" | "expired" | "cancelled" | "pending" {
  // Viva statusId: F = finished/paid, X = cancelled, E = error, A = authorized, M = pending
  if (statusId === "F" || eventTypeId === 1796) return "paid";
  if (eventTypeId === 1797 || statusId === "E") return "failed";
  if (statusId === "X") return "cancelled";
  return "pending";
}

async function sendWhiteLabelEmail(supabase: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const { error } = await supabase.functions.invoke("send-white-label-email", { body });
  if (error) console.error("White-label email failed", error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Viva sends a GET request when registering the webhook to retrieve the Key.
  // We don't currently use a verification key; respond OK so registration succeeds.
  if (req.method === "GET") {
    return json({ Key: Deno.env.get("VIVA_WEBHOOK_KEY") || "glowsuite" });
  }

  if (req.method !== "POST") return json({ error: "Methode niet toegestaan" }, 405);

  try {
    const bodyText = await req.text();
    let payload: any = {};
    try { payload = JSON.parse(bodyText); } catch { /* ignore */ }

    const eventData = payload?.EventData || payload?.eventData || payload || {};
    const eventTypeId = Number(payload?.EventTypeId ?? payload?.eventTypeId ?? 0) || undefined;
    const transactionId = String(eventData?.TransactionId ?? eventData?.transactionId ?? "");
    const orderCodeRaw = eventData?.OrderCode ?? eventData?.orderCode;
    const orderCode = orderCodeRaw != null ? String(orderCodeRaw) : null;
    const statusId = String(eventData?.StatusId ?? eventData?.statusId ?? "");

    if (!transactionId && !orderCode) return json({ error: "Geen orderCode of transactionId" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Locate payment by orderCode (stored in metadata.viva_order_code OR mollie_payment_id slot OR checkout_reference).
    let paymentQuery = orderCode
      ? supabase.from("payments").select("*").or(`mollie_payment_id.eq.${orderCode},checkout_reference.eq.${orderCode}`).eq("provider", "viva").limit(1).maybeSingle()
      : supabase.from("payments").select("*").contains("metadata", { viva_transaction_id: transactionId }).limit(1).maybeSingle();

    const { data: payment } = await paymentQuery;
    if (!payment) return json({ error: "Betaling niet gevonden", orderCode, transactionId }, 404);

    if (payment.is_demo) return json({ success: true, demo: true });

    // Optional: fetch authoritative transaction details from Viva
    let txStatus = mapVivaStatus(statusId, eventTypeId);
    let resolvedOrderCode = orderCode || (payment.metadata as any)?.viva_order_code || null;
    if (transactionId) {
      try {
        const tx = await getVivaTransaction(transactionId);
        txStatus = mapVivaStatus(tx.statusId, eventTypeId);
        resolvedOrderCode = resolvedOrderCode || tx.orderCode;
      } catch (e) {
        console.warn("Viva transaction lookup failed; using event payload only", e);
      }
    }

    // Idempotency: if already paid, skip mutating side-effects.
    if (payment.status === "paid" && txStatus === "paid") {
      return json({ success: true, idempotent: true });
    }

    const isPaid = txStatus === "paid";
    const isFailed = ["failed", "expired", "cancelled"].includes(txStatus);
    const newStatus = isPaid ? "paid" : isFailed ? txStatus : "pending";

    await supabase
      .from("payments")
      .update({
        status: newStatus,
        paid_at: isPaid ? new Date().toISOString() : null,
        webhook_received_at: new Date().toISOString(),
        last_status_sync_at: new Date().toISOString(),
        failure_reason: isFailed ? txStatus : null,
        metadata: {
          ...(payment.metadata || {}),
          viva_order_code: resolvedOrderCode,
          viva_transaction_id: transactionId || null,
          viva_status_id: statusId || null,
          viva_event_type_id: eventTypeId || null,
        },
      })
      .eq("id", payment.id);

    const arSources = ["auto_revenue", "auto_revenue_deposit", "auto_revenue_full"];
    const isAutoRevenue = arSources.includes((payment.metadata as any)?.source);
    const appointmentId = payment.appointment_id || (payment.metadata as any)?.appointment_id || null;

    if (appointmentId) {
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
        const offerId = (payment.metadata as any)?.offer_id;
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

    const membershipId = payment.membership_id || (payment.metadata as any)?.membership_id;
    if (membershipId) {
      const membershipStatus = isPaid ? "active" : isFailed ? "payment_issue" : "active";
      await supabase.from("customer_memberships").update({
        status: membershipStatus,
        last_payment_status: isPaid ? "paid" : isFailed ? "failed" : "open",
        next_payment_at: isPaid ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
        failure_reason: isFailed ? txStatus : null,
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

    return json({ success: true, status: newStatus });
  } catch (error) {
    console.error("viva-webhook error", error);
    return json({ error: (error as Error).message || "Webhook fout" }, 500);
  }
});
