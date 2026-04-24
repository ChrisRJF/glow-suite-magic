import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Rule = {
  id: string;
  user_id: string;
  trigger_type: string;
  action_type: string;
  is_active: boolean;
  delay_value: number | null;
  delay_unit: string | null;
  channel: string | null;
  message_templates: Record<string, string> | null;
  conditions: Record<string, unknown> | null;
  is_demo: boolean;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function addDelay(base: Date, value: number, unit: string) {
  const next = new Date(base);
  if (unit === "hours") next.setHours(next.getHours() + value);
  if (unit === "days") next.setDate(next.getDate() + value);
  return next;
}

function firstName(name?: string | null) {
  return String(name || "").trim().split(/\s+/)[0] || "klant";
}

function renderTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => vars[key] ?? "");
}

async function sendWhiteLabelEmail(admin: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const { error } = await admin.functions.invoke("send-white-label-email", { body });
  if (error) console.error("White-label email failed", error.message);
}

function emailTemplateForTrigger(trigger: string) {
  if (trigger.includes("reminder")) return "appointment_reminder";
  if (trigger.includes("review") || trigger.includes("feedback")) return "review_request";
  if (trigger.includes("membership") || trigger.includes("credits") || trigger.includes("renewal") || trigger.includes("trial")) return "membership_notification";
  if (trigger.includes("cancel")) return "booking_cancellation";
  return "appointment_reminder";
}

function providerAvailable(channel: string, settings: any) {
  if (channel === "email") return Boolean(settings?.email_enabled);
  if (channel === "whatsapp") return Boolean(settings?.whatsapp_enabled);
  if (channel === "sms") return false;
  return true;
}

async function insertRun(admin: any, rule: Rule, settings: any, candidate: any, scheduledFor: Date, reason: string) {
  const channel = rule.channel || "email";
  const customer = candidate.customer || candidate;
  const prefs = candidate.preferences;
  if ((channel === "email" && prefs?.email_opt_out) || (channel === "whatsapp" && prefs?.whatsapp_opt_out) || (channel === "sms" && prefs?.sms_opt_out)) {
    await admin.from("automation_logs").insert({ user_id: rule.user_id, automation_rule_id: rule.id, customer_id: customer?.id || null, event_type: reason, status: "skipped", message: "Klant heeft zich afgemeld voor dit kanaal", is_demo: rule.is_demo });
    return "skipped";
  }

  const idempotencyKey = `${rule.id}:${reason}:${customer?.id || candidate.id}:${candidate.appointment_id || candidate.appointment?.id || candidate.payment_id || candidate.membership_id || candidate.id}`;
  const templates = rule.message_templates || {};
  const salonName = settings?.salon_name || "de salon";
  const body = renderTemplate(templates.nl || templates.en || "", {
    first_name: firstName(customer?.name),
    last_name: String(customer?.name || "").trim().split(/\s+/).slice(1).join(" "),
    salon_name: salonName,
    appointment_date: candidate.appointment?.appointment_date ? new Date(candidate.appointment.appointment_date).toLocaleString("nl-NL") : "",
    service_name: candidate.service?.name || "",
    credits_left: String(candidate.membership?.credits_available ?? ""),
    membership_name: candidate.plan?.name || "",
    voucher_code: candidate.voucher_code || "",
  });
  const recipient = channel === "email" ? customer?.email : customer?.phone;

  const { data: run, error } = await admin.from("automation_runs").insert({
    user_id: rule.user_id,
    automation_rule_id: rule.id,
    customer_id: customer?.id || null,
    appointment_id: candidate.appointment?.id || candidate.appointment_id || null,
    membership_id: candidate.membership?.id || candidate.membership_id || null,
    payment_id: candidate.payment?.id || candidate.payment_id || null,
    channel,
    recipient,
    status: providerAvailable(channel, settings) ? "scheduled" : "skipped",
    scheduled_for: scheduledFor.toISOString(),
    idempotency_key: idempotencyKey,
    payload: {
      message: body,
      reason,
      action_type: rule.action_type,
      salon_name: salonName,
      salon_slug: settings?.public_slug || salonName,
      customer_name: customer?.name || "",
      service_name: candidate.service?.name || "",
      appointment_date: candidate.appointment?.appointment_date || "",
      time: candidate.appointment?.start_time || "",
      employee: candidate.appointment?.employee_id || "",
      membership_name: candidate.plan?.name || "",
      credits: candidate.membership?.credits_available ?? "",
      template_key: emailTemplateForTrigger(rule.trigger_type),
    },
    error_message: providerAvailable(channel, settings) ? null : "Provider vereist",
    is_demo: rule.is_demo,
  }).select("id, status").single();

  if (error?.code === "23505") return "duplicate";
  if (error) throw error;

  await admin.from("automation_logs").insert({
    user_id: rule.user_id,
    automation_rule_id: rule.id,
    automation_run_id: run.id,
    customer_id: customer?.id || null,
    event_type: reason,
    status: run.status,
    message: run.status === "skipped" ? "Provider vereist" : "Bericht ingepland",
    metadata: { channel, recipient_present: Boolean(recipient) },
    is_demo: rule.is_demo,
  });
  return run.status;
}

async function candidatesForRule(admin: any, rule: Rule) {
  const now = new Date();
  const userFilter = { user_id: rule.user_id, is_demo: rule.is_demo };
  const trigger = rule.trigger_type;
  const candidates: any[] = [];

  if (["appointment_reminder_24h", "appointment_reminder_2h", "afspraak_geboekt"].includes(trigger)) {
    const hours = trigger === "appointment_reminder_2h" ? 2 : trigger === "appointment_reminder_24h" ? 24 : 0;
    const from = new Date(now.getTime() + Math.max(0, hours - 1) * 60 * 60 * 1000).toISOString();
    const to = new Date(now.getTime() + (hours + 1) * 60 * 60 * 1000).toISOString();
    const { data } = await admin.from("appointments").select("*, customer:customers(*), service:services(*)").match(userFilter).gte("appointment_date", from).lte("appointment_date", to).limit(50);
    (data || []).forEach((appointment: any) => appointment.customer && candidates.push({ appointment, customer: appointment.customer, service: appointment.service }));
  }

  if (["rebook_30_days", "ask_review_after_appointment", "na_afspraak"].includes(trigger)) {
    const days = trigger === "rebook_30_days" ? 30 : 1;
    const from = new Date(now.getTime() - (days + 1) * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await admin.from("appointments").select("*, customer:customers(*), service:services(*)").match(userFilter).gte("appointment_date", from).lte("appointment_date", to).in("status", ["completed", "afgerond", "confirmed", "gepland"]).limit(50);
    (data || []).forEach((appointment: any) => appointment.customer && candidates.push({ appointment, customer: appointment.customer, service: appointment.service }));
  }

  if (["inactive_60_days", "inactive_90_days", "klant_inactief_4w", "klant_inactief_8w"].includes(trigger)) {
    const days = trigger.includes("90") || trigger.includes("8w") ? 90 : trigger.includes("4w") ? 28 : 60;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data: customers } = await admin.from("customers").select("*").match(userFilter).limit(100);
    for (const customer of customers || []) {
      const { data: latest } = await admin.from("appointments").select("id").match({ ...userFilter, customer_id: customer.id }).gt("appointment_date", cutoff).limit(1);
      if (!latest?.length) candidates.push({ customer });
    }
  }

  if (["payment_failed", "membership_payment_failed", "betaling_mislukt"].includes(trigger)) {
    const { data } = await admin.from("payments").select("*, customer:customers(*)").match(userFilter).in("status", ["failed", "expired", "canceled", "cancelled", "payment_failed"]).gte("updated_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()).limit(50);
    (data || []).forEach((payment: any) => payment.customer && candidates.push({ payment, payment_id: payment.id, customer: payment.customer }));
  }

  if (["credits_almost_finished", "renewal_reminder", "trial_ending_soon", "cancel_winback"].includes(trigger)) {
    let query = admin.from("customer_memberships").select("*, customer:customers(*), plan:membership_plans(*)").match(userFilter).limit(50);
    if (trigger === "credits_almost_finished") query = query.eq("status", "active").lte("credits_available", 1);
    if (trigger === "renewal_reminder") query = query.eq("status", "active").lte("next_payment_at", new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString());
    if (trigger === "cancel_winback") query = query.in("status", ["cancelled", "canceled"]);
    const { data } = await query;
    (data || []).forEach((membership: any) => membership.customer && candidates.push({ membership, membership_id: membership.id, customer: membership.customer, plan: membership.plan }));
  }

  return candidates;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Methode niet toegestaan" }, 405);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: rules, error } = await admin.from("automation_rules").select("*").eq("is_active", true).limit(200);
    if (error) throw error;

    let scheduled = 0;
    let skipped = 0;
    let duplicates = 0;

    for (const rule of (rules || []) as Rule[]) {
      const { data: settings } = await admin.from("settings").select("salon_name, public_slug, timezone, email_enabled, whatsapp_enabled").eq("user_id", rule.user_id).eq("is_demo", rule.is_demo).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const candidates = await candidatesForRule(admin, rule);
      for (const candidate of candidates) {
        const { data: preferences } = candidate.customer?.id ? await admin.from("customer_message_preferences").select("*").eq("user_id", rule.user_id).eq("customer_id", candidate.customer.id).maybeSingle() : { data: null };
        const result = await insertRun(admin, rule, settings, { ...candidate, preferences }, addDelay(new Date(), Number(rule.delay_value || 0), rule.delay_unit || "instant"), rule.trigger_type);
        if (result === "scheduled") scheduled += 1;
        if (result === "skipped") skipped += 1;
        if (result === "duplicate") duplicates += 1;
      }
    }

    const { data: dueRuns } = await admin.from("automation_runs").select("id, user_id, automation_rule_id, channel, recipient, idempotency_key, payload").eq("status", "scheduled").lte("scheduled_for", new Date().toISOString()).limit(100);
    for (const run of dueRuns || []) {
      if (run.channel === "email" && run.recipient) {
        const payload = run.payload || {};
        await sendWhiteLabelEmail(admin, {
          user_id: run.user_id,
          salon_slug: payload.salon_slug,
          salon_name: payload.salon_name,
          recipient_email: run.recipient,
          recipient_name: payload.customer_name,
          template_key: payload.template_key || "appointment_reminder",
          idempotency_key: `automation-${run.id}-${run.idempotency_key}`,
          template_data: payload,
        });
      }
      await admin.from("automation_runs").update({ status: "sent", processed_at: new Date().toISOString() }).eq("id", run.id);
      await admin.from("automation_rules").update({ last_triggered_at: new Date().toISOString() }).eq("id", run.automation_rule_id);
      await admin.from("automation_logs").insert({ user_id: run.user_id, automation_rule_id: run.automation_rule_id, automation_run_id: run.id, event_type: "message_sent", status: "sent", message: "Bericht verwerkt door automation engine", is_demo: false });
    }

    return json({ success: true, scheduled, skipped, duplicates, processed: dueRuns?.length || 0 });
  } catch (error) {
    return json({ error: (error as Error).message || "Automation scheduler failed" }, 500);
  }
});
