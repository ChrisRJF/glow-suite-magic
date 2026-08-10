import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";
import { calculateAutoRebook } from "../_shared/autoRebook.ts";
import { publicAppOrigin, selectChannel } from "../_shared/reminderEngine.ts";
import { getDefaultMessageTemplate, normalizeMessageLang, renderMessage } from "../_shared/messageTranslations.ts";
import { autoRebookEnabled, maskContact, retentionAllowed } from "../_shared/autoRebookGuards.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  customer_id: z.string().uuid(),
  force: z.boolean().optional().default(false),
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * Manual Auto Rebook send from the salon UI. Uses the exact same engine,
 * claim and channel logic as the scheduler so both paths stay in sync.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ---- Auth: validate the caller's JWT in code (verify_jwt is off) ----
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "unauthorized" });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userErr || !userId) return json(401, { error: "unauthorized" });

  let payload: unknown;
  try { payload = await req.json(); } catch { return json(400, { error: "invalid_json" }); }
  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) return json(400, { error: parsed.error.flatten().fieldErrors });
  const { customer_id, force } = parsed.data;

  try {
    // ---- Server-side role check: only roles that may handle customer
    // communication can trigger a manual Auto Rebook send. ----
    const { data: allowedRole } = await admin.rpc("can_manage_operations", { _user_id: userId });
    if (!allowedRole) return json(403, { error: "forbidden" });

    // ---- MASTER TOGGLE (choice B): Auto Rebook OFF blocks every Auto Rebook
    // send, automatic and manual. One switch, no hidden behaviour. ----
    if (!(await autoRebookEnabled(admin, userId))) {
      return json(409, { error: "auto_rebook_disabled" });
    }

    const [{ data: customer }, { data: svcRows }, { data: apptRows }, { data: settingsRow }, { data: profileRow }, { data: tpl }, { data: pref }] =
      await Promise.all([
        admin.from("customers").select("id, name, phone, email, whatsapp_opt_in, preferred_language").eq("id", customer_id).eq("user_id", userId).maybeSingle(),
        admin.from("services").select("id, name, price, rebook_interval_days").eq("user_id", userId),
        admin.from("appointments").select("id, customer_id, service_id, appointment_date, status, price").eq("user_id", userId).eq("customer_id", customer_id),
        admin.from("settings").select("timezone, public_slug, email_enabled").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        admin.from("profiles").select("salon_name").eq("user_id", userId).maybeSingle(),
        admin.from("whatsapp_templates").select("content").eq("user_id", userId).eq("template_type", "revenue_boost").maybeSingle(),
        admin.from("customer_message_preferences").select("email_opt_out, whatsapp_opt_out, retention_opt_out").eq("user_id", userId).eq("customer_id", customer_id).maybeSingle(),
      ]);

    if (!customer) return json(404, { error: "customer_not_found" });
    // Retention consent is separate from transactional consent.
    if (!retentionAllowed(pref)) return json(200, { skipped: true, reason: "retention_opt_out" });

    const serviceIntervals: Record<string, number | null> = {};
    const servicePrices: Record<string, number | null> = {};
    const serviceNames: Record<string, string> = {};
    for (const svc of svcRows || []) {
      serviceIntervals[(svc as any).id] = (svc as any).rebook_interval_days ?? null;
      servicePrices[(svc as any).id] = Number((svc as any).price ?? 0) || null;
      serviceNames[(svc as any).id] = (svc as any).name || "";
    }

    const decision = calculateAutoRebook({
      customer_id,
      appointments: (apptRows || []) as any,
      serviceIntervals,
      servicePrices,
    });
    if (!decision.should_rebook && !force) return json(200, { skipped: true, reason: decision.reason });

    const chan = selectChannel({
      customer: {
        phone: customer.phone,
        email: customer.email,
        whatsapp_opt_in: pref?.whatsapp_opt_out ? false : customer.whatsapp_opt_in,
      },
      waEnabled: true,
      emailEnabled: Boolean((settingsRow as any)?.email_enabled ?? true) && !pref?.email_opt_out,
    });
    if (!chan.channel) return json(200, { skipped: true, reason: chan.reason });

    const { data: claimData, error: claimErr } = await admin.rpc("claim_auto_rebook", {
      _user_id: userId,
      _customer_id: customer_id,
      _service_id: decision.service_id,
      _expected_return_date: decision.expected_return_date,
      _days_overdue: decision.days_overdue,
      _reason: decision.reason,
      _estimated_value: decision.estimated_value,
      _is_demo: false,
      _last_appointment_id: decision.last_appointment_id,
      _token_ttl_days: 60,
    });
    if (claimErr) return json(500, { error: "claim_failed" });
    const claimRow = Array.isArray(claimData) ? claimData[0] : (claimData as any);
    if (!claimRow?.id) return json(200, { skipped: true, reason: "already_sent" });

    const origin = publicAppOrigin();
    const slug = (settingsRow as any)?.public_slug || null;
    const bookingLink = slug
      ? `${origin}/boeken/${slug}?rb=${claimRow.rebook_token}${decision.service_id ? `&svc=${decision.service_id}` : ""}`
      : `${origin}/boeken?rb=${claimRow.rebook_token}`;

    const lang = normalizeMessageLang((customer as any).preferred_language || "nl");
    const salonName = profileRow?.salon_name || "ons salon";
    const message = renderMessage(tpl?.content || getDefaultMessageTemplate("reactivation", lang, "whatsapp"), {
      customer_name: customer.name || "",
      salon_name: salonName,
      booking_link: bookingLink,
    });
    const meta = {
      rebook_action_id: claimRow.id,
      expected_return_date: decision.expected_return_date,
      days_overdue: decision.days_overdue,
      interval_days: decision.recommended_interval_days,
      interval_source: decision.interval_source,
      reason: decision.reason,
      booking_link: bookingLink,
      manual: true,
    };

    // Audit trail for manual sends. No PII: only ids and decision metadata.
    const auditManualSend = async (channel: string) => {
      await admin.from("audit_logs").insert({
        user_id: userId,
        actor_user_id: userId,
        action: "auto_rebook_manual_send",
        target_type: "rebook_action",
        target_id: claimRow.id,
        is_demo: false,
        details: {
          channel,
          customer_id,
          interval_source: decision.interval_source,
          interval_days: decision.recommended_interval_days,
          days_overdue: decision.days_overdue,
          reason: decision.reason,
          forced: Boolean(force) && !decision.should_rebook,
        },
      });
    };

    if (chan.channel === "whatsapp") {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          user_id: userId,
          to: customer.phone,
          message,
          customer_id,
          kind: "auto_rebook",
          reminder_type: "auto_rebook",
          meta,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !(data.success || data.deduped)) {
        await admin.from("rebook_actions").update({ status: "retry", channel: "whatsapp" }).eq("id", claimRow.id);
        return json(502, { error: "send_failed" });
      }
      await admin.from("rebook_actions").update({ status: "verzonden", channel: "whatsapp", sent_at: new Date().toISOString() }).eq("id", claimRow.id);
      await auditManualSend("whatsapp");
      return json(200, { success: true, channel: "whatsapp", booking_link: bookingLink });
    }

    const invokeRes = await admin.functions.invoke("send-white-label-email", {
      body: {
        user_id: userId,
        salon_name: salonName,
        salon_slug: slug || undefined,
        recipient_email: customer.email,
        recipient_name: customer.name || "",
        template_key: "auto_rebook",
        idempotency_key: `auto-rebook-${claimRow.id}`,
        language: lang,
        template_data: {
          customer_name: customer.name || "",
          salon_name: salonName,
          service_name: decision.service_id ? serviceNames[decision.service_id] || "" : "",
          last_visit_date: decision.last_appointment_date,
          rebook_url: bookingLink,
          booking_url: bookingLink,
        },
      },
    });
    if (invokeRes.error) {
      await admin.from("rebook_actions").delete().eq("id", claimRow.id);
      return json(502, { error: "send_failed" });
    }
    await admin.from("rebook_actions").update({ status: "verzonden", channel: "email", sent_at: new Date().toISOString() }).eq("id", claimRow.id);
    await auditManualSend("email");
    await admin.from("whatsapp_logs").insert({
      user_id: userId,
      customer_id,
      to_number: `email:${maskContact(customer.email)}`,
      message: "[email] Auto Rebook",
      status: "sent",
      kind: "auto_rebook",
      reminder_type: "auto_rebook",
      meta: { ...meta, channel: "email", fallback_reason: chan.reason },
    });
    return json(200, { success: true, channel: "email", booking_link: bookingLink });
  } catch (e) {
    console.error("auto-rebook-send error", e instanceof Error ? e.message : e);
    return json(500, { error: "internal_error" });
  }
});
