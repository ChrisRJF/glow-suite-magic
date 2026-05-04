// WhatsApp inbound handler (Twilio-style POST).
// Detects "JA"-style replies and converts the latest pending offer into a held appointment + Mollie deposit link.
// Demo mode = full simulation, no real Mollie or WhatsApp.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YES_PATTERNS = ["ja", "yes", "ok", "oké", "oke", "graag", "doe maar", "akkoord"];

function txml(message: string) {
  // Twilio expects TwiML (XML) when responding; but we usually just 200 OK.
  // Returning a tiny TwiML keeps Twilio happy if it expects a reply.
  const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/xml" },
  });
}

function ok() {
  return new Response("ok", { status: 200, headers: corsHeaders });
}

function normalizePhone(phone: string): string {
  if (!phone) return "";
  let p = phone.trim();
  p = p.replace(/^whatsapp:/i, "");
  p = p.replace(/[^\d+]/g, "");
  if (!p) return "";
  if (p.startsWith("+")) return p;
  if (p.startsWith("0")) return "+31" + p.substring(1);
  return "+" + p;
}

function isYes(body: string): boolean {
  if (!body) return false;
  const norm = body.trim().toLowerCase();
  if (!norm) return false;
  // exact word match or starts with one of the yes tokens
  for (const p of YES_PATTERNS) {
    if (norm === p) return true;
    if (norm.startsWith(p + " ") || norm.startsWith(p + "!") || norm.startsWith(p + ".")) return true;
  }
  return false;
}

async function sendWhatsApp(
  admin: ReturnType<typeof createClient>,
  args: { user_id: string; to: string; message: string; customer_id?: string | null; appointment_id?: string | null; meta?: Record<string, unknown> },
) {
  try {
    const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-send`;
    await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        user_id: args.user_id,
        to: args.to,
        message: args.message,
        customer_id: args.customer_id ?? null,
        appointment_id: args.appointment_id ?? null,
        kind: "auto_revenue_reply",
        meta: args.meta || {},
      }),
    });
  } catch (e) {
    console.error("whatsapp-inbound: send failed", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Parse body — Twilio sends application/x-www-form-urlencoded; also accept JSON.
    const ct = req.headers.get("content-type") || "";
    let from = "";
    let bodyText = "";
    let raw: Record<string, unknown> = {};
    if (ct.includes("application/json")) {
      const j = await req.json().catch(() => ({}));
      raw = j;
      from = String(j.From || j.from || j.from_number || "");
      bodyText = String(j.Body || j.body || j.message || "");
    } else {
      const txt = await req.text();
      const params = new URLSearchParams(txt);
      raw = Object.fromEntries(params.entries());
      from = String(params.get("From") || "");
      bodyText = String(params.get("Body") || "");
    }

    const fromPhone = normalizePhone(from);
    if (!fromPhone) {
      console.warn("whatsapp-inbound: empty From");
      return ok();
    }

    // Find customer by phone (LIVE only — we never reuse demo data in live).
    // Active mode determined per-customer's account: try to find ANY customer match,
    // then read their account is_demo to decide.
    const { data: candidates } = await admin
      .from("customers")
      .select("id, user_id, name, phone, whatsapp_opt_in, is_demo")
      .or(`phone.eq.${fromPhone},phone.eq.${fromPhone.replace(/^\+/, "")}`)
      .limit(5);

    const customer = (candidates || []).find((c) => Boolean(c.whatsapp_opt_in)) || (candidates || [])[0] || null;

    // Always log the inbound message (under the matched customer's account if any)
    const inboundUserId = customer?.user_id || null;
    const inboundIsDemo = Boolean(customer?.is_demo);

    if (inboundUserId) {
      await admin.from("whatsapp_inbound_messages").insert({
        user_id: inboundUserId,
        customer_id: customer?.id ?? null,
        from_number: fromPhone,
        body: bodyText,
        processed: false,
        metadata: raw as any,
        is_demo: inboundIsDemo,
      });
    } else {
      console.warn("whatsapp-inbound: no customer match", fromPhone);
      return txml("We konden je nummer niet vinden in ons systeem.");
    }

    // Only act on YES replies
    if (!isYes(bodyText)) {
      await admin
        .from("whatsapp_inbound_messages")
        .update({ processed: true, metadata: { ...(raw as any), reason: "not_yes" } })
        .eq("user_id", inboundUserId)
        .eq("from_number", fromPhone)
        .eq("body", bodyText)
        .eq("processed", false);
      return ok();
    }

    // Respect WhatsApp settings (don't act if disabled)
    const { data: waSettings } = await admin
      .from("whatsapp_settings")
      .select("enabled")
      .eq("user_id", inboundUserId)
      .maybeSingle();

    // Respect customer opt-in
    if (customer && customer.whatsapp_opt_in === false) {
      return ok();
    }

    // Find latest valid offer (sent + not expired)
    const { data: offer } = await admin
      .from("auto_revenue_offers")
      .select("*")
      .eq("user_id", inboundUserId)
      .eq("customer_id", customer!.id)
      .eq("is_demo", inboundIsDemo)
      .eq("status", "sent")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!offer) {
      if (waSettings?.enabled !== false) {
        await sendWhatsApp(admin, {
          user_id: inboundUserId,
          to: fromPhone,
          message: "Ik kon geen openstaand aanbod vinden.",
          customer_id: customer!.id,
        });
      }
      return ok();
    }

    // Check slot availability — block on existing non-cancelled appointments for same employee/date/start
    const apptDateIso = new Date(`${offer.appointment_date}T${offer.start_time}`).toISOString();

    const { data: clash } = await admin
      .from("appointments")
      .select("id, status")
      .eq("user_id", inboundUserId)
      .eq("is_demo", inboundIsDemo)
      .eq("appointment_date", apptDateIso)
      .eq("employee_id", offer.employee_id || "")
      .not("status", "in", "(geannuleerd,cancelled)")
      .limit(1);

    if (clash && clash.length > 0) {
      await admin.from("auto_revenue_offers").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", offer.id);
      if (waSettings?.enabled !== false) {
        await sendWhatsApp(admin, {
          user_id: inboundUserId,
          to: fromPhone,
          message: "Helaas, deze plek is net bezet. We laten het je weten zodra er een nieuwe plek vrijkomt.",
          customer_id: customer!.id,
        });
      }
      return ok();
    }

    // Load deposit/hold settings
    const { data: settings } = await admin
      .from("settings")
      .select("auto_revenue_reservation_hold_minutes")
      .eq("user_id", inboundUserId)
      .maybeSingle();
    const holdMinutes = Number((settings as any)?.auto_revenue_reservation_hold_minutes ?? 15);
    const expiresAt = new Date(Date.now() + holdMinutes * 60_000).toISOString();

    // Load service price
    const { data: service } = offer.service_id
      ? await admin.from("services").select("name, price").eq("id", offer.service_id).maybeSingle()
      : { data: null };

    // Create pending_payment appointment
    const { data: appt, error: apptErr } = await admin
      .from("appointments")
      .insert({
        user_id: inboundUserId,
        customer_id: customer!.id,
        service_id: offer.service_id,
        employee_id: offer.employee_id,
        appointment_date: apptDateIso,
        start_time: offer.start_time,
        end_time: offer.end_time,
        status: "pending_payment",
        payment_required: true,
        payment_status: "pending",
        payment_expires_at: expiresAt,
        price: Number((service as any)?.price || 0),
        source: "auto_revenue_reply",
        is_demo: inboundIsDemo,
      })
      .select()
      .single();

    if (apptErr || !appt) {
      console.error("whatsapp-inbound: appointment insert failed", apptErr);
      await admin.from("auto_revenue_offers").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", offer.id);
      return ok();
    }

    // Create deposit payment via Mollie (or simulate in demo)
    let checkoutUrl: string | null = null;
    try {
      const payRes = await fetch(`${SUPABASE_URL}/functions/v1/create-auto-revenue-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          user_id: inboundUserId,
          appointment_id: appt.id,
          offer_id: offer.id,
          customer_id: customer!.id,
          is_demo: inboundIsDemo,
        }),
      });
      const payJson = await payRes.json().catch(() => ({}));
      checkoutUrl = (payJson as any)?.checkout_url || null;
      if (!payRes.ok || !checkoutUrl) {
        throw new Error((payJson as any)?.error || "Geen checkout link ontvangen");
      }
    } catch (e) {
      console.error("whatsapp-inbound: payment creation failed", e);
      // Roll back: cancel appointment + mark offer failed
      await admin.from("appointments").update({ status: "geannuleerd", payment_status: "failed" }).eq("id", appt.id);
      await admin.from("auto_revenue_offers").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", offer.id);
      if (waSettings?.enabled !== false) {
        await sendWhatsApp(admin, {
          user_id: inboundUserId,
          to: fromPhone,
          message: "Het lukte niet om een betaallink aan te maken. Onze excuses — we nemen contact met je op.",
          customer_id: customer!.id,
        });
      }
      return ok();
    }

    // Update offer
    await admin
      .from("auto_revenue_offers")
      .update({ status: "pending_payment", appointment_id: appt.id, updated_at: new Date().toISOString() })
      .eq("id", offer.id);

    // Send confirmation WhatsApp with payment link
    const timeStr = String(offer.start_time).substring(0, 5);
    const message = `Top! Ik heb de plek voor je gereserveerd om ${timeStr} 🙌\n\nBevestig met een aanbetaling via:\n${checkoutUrl}\n\nNa betaling is je afspraak definitief.`;

    if (waSettings?.enabled !== false) {
      await sendWhatsApp(admin, {
        user_id: inboundUserId,
        to: fromPhone,
        message,
        customer_id: customer!.id,
        appointment_id: appt.id,
        meta: { source: "auto_revenue_reply", offer_id: offer.id },
      });
    }

    // Mark inbound processed
    await admin
      .from("whatsapp_inbound_messages")
      .update({ processed: true, metadata: { ...(raw as any), offer_id: offer.id, appointment_id: appt.id } })
      .eq("user_id", inboundUserId)
      .eq("from_number", fromPhone)
      .eq("body", bodyText)
      .eq("processed", false);

    return ok();
  } catch (e) {
    console.error("whatsapp-inbound error", e);
    return ok(); // never 500 a webhook
  }
});
