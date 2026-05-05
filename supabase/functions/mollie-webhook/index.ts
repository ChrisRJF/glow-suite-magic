import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function mapPaymentStatus(status: string) {
  if (status === "paid") return { payment_status: "paid", appointment_status: "confirmed", paid_at: new Date().toISOString() };
  if (["failed", "expired", "canceled", "cancelled"].includes(status)) return { payment_status: "payment_failed", appointment_status: "pending_confirmation", paid_at: null };
  if (status === "authorized") return { payment_status: "authorized", appointment_status: "pending_confirmation", paid_at: null };
  return { payment_status: "pending", appointment_status: "pending_confirmation", paid_at: null };
}

async function logWebhookValidation(supabase: ReturnType<typeof createClient>, payment: any, action: string, details: Record<string, unknown>) {
  await supabase.from("audit_logs").insert({
    user_id: payment.user_id,
    actor_user_id: payment.user_id,
    action,
    target_type: "mollie_webhook",
    target_id: payment.id,
    details,
    is_demo: false,
  });
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 48) || "salon";
}

async function sendWhiteLabelEmail(supabase: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const { error } = await supabase.functions.invoke("send-white-label-email", { body });
  if (error) console.error("White-label email failed", error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Methode niet toegestaan" }, 405);

  try {
    const bodyText = await req.text();
    const params = new URLSearchParams(bodyText);
    let molliePaymentId = params.get("id");

    if (!molliePaymentId && bodyText.trim().startsWith("{")) {
      const body = JSON.parse(bodyText);
      molliePaymentId = body.id;
    }

    if (!molliePaymentId) return json({ error: "Ontbrekende Mollie betaling" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: payment, error: paymentReadError } = await supabase
      .from("payments")
      .select("id, user_id, appointment_id, customer_id, amount, metadata, is_demo, order_id, membership_id")
      .eq("mollie_payment_id", molliePaymentId)
      .maybeSingle();
    if (paymentReadError) throw paymentReadError;
    if (!payment) return json({ error: "Betaling niet gevonden" }, 404);

    if (payment.is_demo) return json({ success: true, demo: true });

    const { data: settings } = await supabase
      .from("settings")
      .select("id")
      .eq("user_id", payment.user_id)
      .eq("is_demo", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: connection } = await supabase
      .from("mollie_connections")
      .select("mollie_access_token")
      .eq("user_id", payment.user_id)
      .eq("salon_id", settings?.id)
      .eq("is_active", true)
      .is("disconnected_at", null)
      .maybeSingle();
    if (!connection) {
      await logWebhookValidation(supabase, payment, "mollie_webhook_validation_failed", { mollie_payment_id: molliePaymentId, reason: "missing_connection" });
      return json({ error: "Mollie account is niet verbonden" }, 422);
    }

    const mollieResponse = await fetch(`https://api.mollie.com/v2/payments/${molliePaymentId}`, {
      headers: { Authorization: `Bearer ${(connection as any).mollie_access_token}` },
    });
    const molliePayment = await mollieResponse.json();
    if (!mollieResponse.ok) {
      await logWebhookValidation(supabase, payment, "mollie_webhook_validation_failed", { mollie_payment_id: molliePaymentId, reason: "mollie_fetch_failed", status: mollieResponse.status });
      return json({ error: "Mollie betaling kon niet worden opgehaald" }, 502);
    }

    const status = String(molliePayment.status || "pending");
    const mapped = mapPaymentStatus(status);
    const metadata = molliePayment.metadata || {};
    const appointmentId = payment.appointment_id || metadata.appointment_id;

    const { error: paymentUpdateError } = await supabase
      .from("payments")
      .update({
        status,
        paid_at: mapped.paid_at,
        webhook_received_at: new Date().toISOString(),
        last_status_sync_at: new Date().toISOString(),
        failure_reason: ["failed", "expired", "canceled", "cancelled"].includes(status) ? status : null,
        mollie_method: molliePayment.method || null,
        metadata: { ...(payment.metadata || {}), ...metadata, mollie_status: status, mollie_payload: molliePayment },
      })
      .eq("id", payment.id);
    if (paymentUpdateError) throw paymentUpdateError;

    const arSources = ["auto_revenue_deposit", "auto_revenue_full"];
    const isAutoRevenue = arSources.includes((payment.metadata as any)?.source) || arSources.includes(metadata?.source);

    if (appointmentId) {
      const amountPaid = status === "paid" ? Number(payment.amount || 0) : 0;
      // For auto-revenue deposits, paid → 'gepland' (Dutch convention used in this app)
      const apptStatusToSet = isAutoRevenue && status === "paid"
        ? "gepland"
        : isAutoRevenue && ["failed", "expired", "canceled", "cancelled"].includes(status)
          ? "geannuleerd"
          : mapped.appointment_status;
      const apptPaymentStatus = isAutoRevenue && status === "paid" ? "paid" : mapped.payment_status;

      const updatePayload: Record<string, unknown> = {
        payment_status: apptPaymentStatus,
        status: apptStatusToSet,
        amount_paid: amountPaid,
      };
      if (isAutoRevenue && status === "paid") {
        updatePayload.payment_expires_at = null;
      }

      const { data: appointment } = await supabase.from("appointments").select("booking_group_id").eq("id", appointmentId).maybeSingle();
      if (appointment?.booking_group_id) {
        await supabase.from("appointments").update(updatePayload).eq("booking_group_id", appointment.booking_group_id);
      }
      await supabase.from("appointments").update(updatePayload).eq("id", appointmentId);

      if (isAutoRevenue) {
        const offerId = (payment.metadata as any)?.offer_id || metadata?.offer_id;
        if (offerId) {
          const offerStatus = status === "paid"
            ? "paid"
            : ["failed", "expired", "canceled", "cancelled"].includes(status)
              ? "expired"
              : "pending_payment";
          // Idempotent — only update if status changed
          await supabase
            .from("auto_revenue_offers")
            .update({ status: offerStatus, updated_at: new Date().toISOString() })
            .eq("id", offerId)
            .neq("status", offerStatus);
        }
      }
    }

    if (status === "paid") {
      const { data: settings } = await supabase.from("settings").select("salon_name, public_slug").eq("user_id", payment.user_id).eq("is_demo", false).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const { data: customer } = payment.customer_id ? await supabase.from("customers").select("name, email, phone").eq("id", payment.customer_id).eq("user_id", payment.user_id).maybeSingle() : { data: null };
      if (customer?.email) {
        await sendWhiteLabelEmail(supabase, {
          user_id: payment.user_id,
          salon_slug: settings?.public_slug || slugify(settings?.salon_name || "salon"),
          salon_name: settings?.salon_name || "Salon",
          recipient_email: customer.email,
          recipient_name: customer.name || "",
          template_key: payment.membership_id ? "membership_notification" : "payment_receipt",
          idempotency_key: `payment-${payment.id}-${status}`,
          template_data: { customer_name: customer.name, amount: payment.amount, method: molliePayment.method || payment.method, reference: payment.id, status: "Actief" },
        });
      }

      // WhatsApp booking confirmation after successful payment (deduped via unique index)
      if (appointmentId && customer?.phone) {
        try {
          const { data: waSettings } = await supabase
            .from("whatsapp_settings")
            .select("enabled, send_booking_confirmation")
            .eq("user_id", payment.user_id)
            .maybeSingle();

          if (waSettings?.enabled && waSettings?.send_booking_confirmation) {
            const { data: appt } = await supabase
              .from("appointments")
              .select("id, appointment_date, start_time, booking_token, service_id")
              .eq("id", appointmentId)
              .maybeSingle();
            if (appt) {
              const { data: service } = appt.service_id
                ? await supabase.from("services").select("name").eq("id", appt.service_id).maybeSingle()
                : { data: null };
              const { data: tpl } = await supabase
                .from("whatsapp_templates")
                .select("content, is_active")
                .eq("user_id", payment.user_id)
                .eq("template_type", "booking_confirmation")
                .maybeSingle();

              const DEFAULT_TPL = `Beste {{customer_name}},\n\nHierbij bevestigen we je afspraak op {{appointment_date}} om {{appointment_time}} voor de volgende behandeling(en):\n\n{{services}}\n\nLet op: de afspraak kan kosteloos tot uiterlijk 12 uur van tevoren worden verplaatst via deze link:\n{{reschedule_link}}\n\nTot dan!\n\n{{salon_name}}`;
              const templateContent = (tpl?.is_active === false ? null : tpl?.content) || DEFAULT_TPL;

              const apptInstant = new Date(appt.appointment_date as string);
              const dateStr = apptInstant.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
              const timeStr = String(appt.start_time || "").substring(0, 5);
              const rescheduleLink = appt.booking_token
                ? `https://glowsuite.nl/afspraak/${appt.booking_token}`
                : `https://glowsuite.nl/afspraak`;
              if (!appt.booking_token) console.warn("WhatsApp: missing booking_token", appt.id);

              const waMessage = isAutoRevenue
                ? "Je afspraak staat vast! 🙌 Tot dan."
                : templateContent
                    .replace(/\{\{\s*customer_name\s*\}\}/g, customer.name || "")
                    .replace(/\{\{\s*salon_name\s*\}\}/g, settings?.salon_name || "ons salon")
                    .replace(/\{\{\s*appointment_date\s*\}\}/g, dateStr)
                    .replace(/\{\{\s*appointment_time\s*\}\}/g, timeStr)
                    .replace(/\{\{\s*services\s*\}\}/g, service?.name ? `• ${service.name}` : "")
                    .replace(/\{\{\s*reschedule_link\s*\}\}/g, rescheduleLink)
                    .replace(/\{\{\s*review_link\s*\}\}/g, "");

              const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-send`;
              fetch(fnUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
                body: JSON.stringify({
                  user_id: payment.user_id,
                  to: customer.phone,
                  message: waMessage,
                  customer_id: payment.customer_id,
                  appointment_id: appointmentId,
                  kind: "confirmation",
                  meta: { trigger: "payment_paid" },
                }),
              }).catch((e) => console.error("WhatsApp send (mollie webhook) failed", e));
            }
          }
        } catch (waErr) {
          console.error("WhatsApp dispatch (mollie webhook) error", waErr);
        }
      }
    }

    const orderId = payment.order_id || metadata.order_id;
    if (orderId) {
      const orderStatus = status === "paid" ? "paid" : ["failed", "expired", "canceled", "cancelled"].includes(status) ? "failed" : "open";
      await supabase.from("webshop_orders").update({
        payment_status: orderStatus,
        status: orderStatus,
        mollie_payment_id: molliePaymentId,
        updated_at: new Date().toISOString(),
      }).eq("id", orderId).eq("user_id", payment.user_id);
      if (status === "paid") {
        const { error: stockError } = await supabase.rpc("process_paid_webshop_order_stock", { _order_id: orderId });
        if (stockError) throw stockError;
      }
    }

    const membershipId = payment.membership_id || metadata.membership_id;
    if (membershipId) {
      const membershipStatus = status === "paid" ? "active" : ["failed", "expired", "canceled", "cancelled"].includes(status) ? "payment_issue" : "active";
      await supabase.from("customer_memberships").update({
        status: membershipStatus,
        last_payment_status: status === "paid" ? "paid" : ["failed", "expired", "canceled", "cancelled"].includes(status) ? "failed" : "open",
        next_payment_at: status === "paid" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
        failure_reason: ["failed", "expired", "canceled", "cancelled"].includes(status) ? status : null,
        updated_at: new Date().toISOString(),
      }).eq("id", membershipId).eq("user_id", payment.user_id);
    }

    await logWebhookValidation(supabase, payment, status === "paid" ? "mollie_webhook_payment_success" : ["failed", "expired", "canceled", "cancelled"].includes(status) ? "mollie_webhook_payment_failed" : "mollie_webhook_validated", { mollie_payment_id: molliePaymentId, status, method: molliePayment.method || null, appointment_id: appointmentId || null });

    return json({ success: true });
  } catch (error) {
    return json({ error: (error as Error).message || "Webhook kon niet worden verwerkt" }, 500);
  }
});
