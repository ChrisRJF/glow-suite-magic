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
  if (["failed", "expired", "canceled"].includes(status)) return { payment_status: "payment_failed", appointment_status: "pending_confirmation", paid_at: null };
  if (status === "authorized") return { payment_status: "authorized", appointment_status: "pending_confirmation", paid_at: null };
  return { payment_status: "pending", appointment_status: "pending_confirmation", paid_at: null };
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

    const mollieApiKey = Deno.env.get("MOLLIE_API_KEY");
    if (!mollieApiKey) return json({ error: "Mollie is niet geconfigureerd" }, 500);

    const mollieResponse = await fetch(`https://api.mollie.com/v2/payments/${molliePaymentId}`, {
      headers: { Authorization: `Bearer ${mollieApiKey}` },
    });
    const molliePayment = await mollieResponse.json();
    if (!mollieResponse.ok) return json({ error: "Mollie betaling kon niet worden opgehaald" }, 502);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const status = String(molliePayment.status || "pending");
    const mapped = mapPaymentStatus(status);
    const metadata = molliePayment.metadata || {};

    const { data: payment, error: paymentReadError } = await supabase
      .from("payments")
      .select("id, appointment_id, customer_id, amount, metadata")
      .eq("mollie_payment_id", molliePaymentId)
      .maybeSingle();
    if (paymentReadError) throw paymentReadError;

    const appointmentId = payment?.appointment_id || metadata.appointment_id;
    if (!appointmentId) return json({ error: "Geen afspraak gekoppeld aan betaling" }, 422);

    const { error: paymentUpdateError } = await supabase
      .from("payments")
      .update({
        status,
        paid_at: mapped.paid_at,
        webhook_received_at: new Date().toISOString(),
        failure_reason: ["failed", "expired", "canceled"].includes(status) ? status : null,
        metadata: { ...(payment?.metadata || {}), ...metadata, mollie_status: status },
      })
      .eq(payment?.id ? "id" : "mollie_payment_id", payment?.id || molliePaymentId);
    if (paymentUpdateError) throw paymentUpdateError;

    const { data: appointment } = await supabase
      .from("appointments")
      .select("booking_group_id")
      .eq("id", appointmentId)
      .maybeSingle();

    if (appointment?.booking_group_id) {
      await supabase
        .from("appointments")
        .update({ payment_status: mapped.payment_status, status: mapped.appointment_status, amount_paid: status === "paid" ? Number(payment?.amount || 0) : 0 })
        .eq("booking_group_id", appointment.booking_group_id);
    }

    await supabase
      .from("appointments")
      .update({ payment_status: mapped.payment_status, status: mapped.appointment_status, amount_paid: status === "paid" ? Number(payment?.amount || 0) : 0 })
      .eq("id", appointmentId);

    return json({ success: true });
  } catch (error) {
    return json({ error: (error as Error).message || "Webhook kon niet worden verwerkt" }, 500);
  }
});
