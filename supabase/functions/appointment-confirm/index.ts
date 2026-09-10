import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";
import { cancelAppointmentCanonical } from "../_shared/cancelAppointment.ts";
import { generateFormToken, hashToken } from "../_shared/formCanonical.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get"), token: z.string().min(6).max(200) }),
  // Klantportaal light (P3): alleen gegevens van deze ene afspraak.
  z.object({ action: z.literal("portal"), token: z.string().min(6).max(200) }),
  z.object({
    action: z.literal("form_link"),
    token: z.string().min(6).max(200),
    request_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("respond"),
    token: z.string().min(6).max(200),
    response: z.enum(["confirm", "decline"]),
  }),
]);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for") || "";
  return xf.split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) return json(400, { error: "invalid_request" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Rate limit: 20 hits / 5 min per token, 60 hits / 5 min per IP. Blocks
  // brute-force enumeration without touching normal customers who click once.
  const ip = clientIp(req);
  const tokenBucket = `appt-confirm:token:${parsed.data.token}`;
  const ipBucket = `appt-confirm:ip:${ip}`;
  const [tokenOk, ipOk] = await Promise.all([
    supabase.rpc("check_public_rate_limit", { _bucket: tokenBucket, _max: 20, _window_seconds: 300 }),
    supabase.rpc("check_public_rate_limit", { _bucket: ipBucket, _max: 60, _window_seconds: 300 }),
  ]);
  if (tokenOk.data === false || ipOk.data === false) {
    return json(429, { error: "rate_limited" });
  }

  const { data: appt, error: fetchErr } = await supabase
    .from("appointments")
    .select("id, user_id, customer_id, service_id, appointment_date, start_time, status, confirmation_status, confirmation_responded_at, booking_token, is_demo")
    .eq("booking_token", parsed.data.token)
    .maybeSingle();

  if (fetchErr) return json(500, { error: "lookup_failed" });
  if (!appt) return json(404, { error: "invalid_token" });

  // Expired = appointment date already passed
  const apptTime = new Date(appt.appointment_date).getTime();
  const expired = apptTime + 24 * 60 * 60 * 1000 < Date.now();

  const [{ data: customer }, { data: service }] = await Promise.all([
    appt.customer_id
      ? supabase
          .from("customers")
          .select("name, archived_at, pseudonymized_at, communication_blocked")
          .eq("id", appt.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    appt.service_id
      ? supabase.from("services").select("name, aftercare_text").eq("id", appt.service_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const cust = customer as
    | { name?: string; archived_at?: string | null; pseudonymized_at?: string | null; communication_blocked?: boolean | null }
    | null;
  const customerBlocked = Boolean(cust?.archived_at || cust?.pseudonymized_at || cust?.communication_blocked);

  const publicAppt = {
    id: appt.id,
    appointment_date: appt.appointment_date,
    start_time: appt.start_time,
    status: appt.status,
    confirmation_status: appt.confirmation_status ?? "pending",
    confirmation_responded_at: appt.confirmation_responded_at,
    customer_name: (customer as { name?: string } | null)?.name ?? null,
    service_name: (service as { name?: string } | null)?.name ?? null,
    expired,
  };

  if (parsed.data.action === "get") {
    return json(200, { appointment: publicAppt });
  }

  // ---------------------------------------------------------------------
  // P3 Klantportaal light: strikt afspraakgebonden, geen klantaccount.
  // ---------------------------------------------------------------------
  if (parsed.data.action === "portal" || parsed.data.action === "form_link") {
    if (customerBlocked) return json(410, { error: "unavailable" });

    // Openstaande en afgeronde formulieren van uitsluitend deze afspraak.
    const { data: reqs } = await supabase
      .from("form_requests")
      .select("id, status, expires_at, template_id, appointment_id, customer_id, user_id")
      .eq("appointment_id", appt.id)
      .order("created_at", { ascending: true });
    const requests = (reqs ?? []) as Array<{
      id: string; status: string; expires_at: string | null; template_id: string | null;
      appointment_id: string; customer_id: string; user_id: string;
    }>;

    if (parsed.data.action === "form_link") {
      const target = requests.find((r) => r.id === parsed.data.request_id);
      if (!target) return json(404, { error: "not_found" });
      if (!["draft", "sent", "opened"].includes(target.status)) {
        return json(410, { error: "not_open" });
      }
      if (target.expires_at && new Date(target.expires_at).getTime() < Date.now()) {
        return json(410, { error: "expired" });
      }
      // Bestaande architectuur: token roteren en alleen de hash opslaan.
      const raw = generateFormToken();
      const { error: rotErr } = await supabase
        .from("form_requests")
        .update({ token_hash: await hashToken(raw), updated_at: new Date().toISOString() })
        .eq("id", target.id)
        .eq("appointment_id", appt.id);
      if (rotErr) return json(500, { error: "link_failed" });
      return json(200, { path: `/formulier/${raw}` });
    }

    const templateIds = [...new Set(requests.map((r) => r.template_id).filter(Boolean))] as string[];
    const { data: tpls } = templateIds.length
      ? await supabase.from("form_templates").select("id, title").in("id", templateIds)
      : { data: [] as Array<{ id: string; title: string }> };
    const titleById = new Map((tpls ?? []).map((t: { id: string; title: string }) => [t.id, t.title]));

    const [{ data: settingsRow }, { data: profileRow }] = await Promise.all([
      supabase.from("settings").select("salon_name").eq("user_id", appt.user_id).maybeSingle(),
      supabase.from("profiles").select("salon_name").eq("id", appt.user_id).maybeSingle(),
    ]);
    const salonName =
      (settingsRow as { salon_name?: string } | null)?.salon_name ||
      (profileRow as { salon_name?: string } | null)?.salon_name ||
      "de salon";

    let documents: Array<{ document_type: string; created_at: string }> = [];
    try {
      const { data: docs } = await supabase
        .from("document_exports")
        .select("scope, created_at, appointment_id, status")
        .eq("appointment_id", appt.id)
        .eq("status", "ready")
        .order("created_at", { ascending: false })
        .limit(10);
      documents = ((docs ?? []) as Array<{ scope: string; created_at: string }>).map((d) => ({
        document_type: d.scope === "treatment_record" ? "Behandelverslag" : "Dossierdocument",
        created_at: d.created_at,
      }));
    } catch (_) { /* documenten zijn optioneel */ }

    const done = appt.status === "afgerond" || appt.status === "completed";
    return json(200, {
      appointment: publicAppt,
      salon_name: salonName,
      forms: requests.map((r) => ({
        id: r.id,
        title: (r.template_id && titleById.get(r.template_id)) || "Formulier",
        status: r.status,
        open: ["draft", "sent", "opened"].includes(r.status),
      })),
      documents,
      aftercare: done ? ((service as { aftercare_text?: string | null } | null)?.aftercare_text ?? null) : null,
      treatment_done: done,
    });
  }


  if (expired) return json(410, { error: "expired", appointment: publicAppt });

  const desired = parsed.data.response === "confirm" ? "confirmed" : "declined";

  // Idempotent: if already in the desired state, return current state
  if (appt.confirmation_status === desired) {
    return json(200, { appointment: publicAppt, already: true });
  }

  const nowIso = new Date().toISOString();

  if (desired === "declined") {
    // Delegate to the canonical cancellation service so ALL side-effects
    // (customer history, cleanup, waitlist signal, notification, audit,
    //  reminder + payment cleanup) run through one code path.
    const result = await cancelAppointmentCanonical(supabase, {
      appointmentId: appt.id,
      source: "public_confirmation",
      bookingToken: parsed.data.token,
      reason: "Klant zei af via publieke bevestigingslink",
    });
    if (!result.ok) return json(500, { error: "cancel_failed" });

    // Always stamp the confirmation response fields for the public flow.
    await supabase
      .from("appointments")
      .update({
        confirmation_status: "declined",
        confirmation_responded_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", appt.id);

    try {
      await supabase.from("automation_logs").insert({
        user_id: appt.user_id,
        event_type: "appointment_declined",
        status: "success",
        customer_id: appt.customer_id,
        is_demo: appt.is_demo,
        message: "Klant zei afspraak af via publieke link",
        metadata: {
          source: "appointment-confirm",
          appointment_id: appt.id,
          channel: "public_link",
          response: "declined",
          canonical: true,
          side_effects: result.side_effects,
          already_cancelled: result.alreadyCancelled ?? false,
        },
      });
    } catch (_) { /* non-fatal */ }

    return json(200, {
      appointment: { ...publicAppt, confirmation_status: "declined", confirmation_responded_at: nowIso, status: "geannuleerd" },
    });
  }

  // Confirm path unchanged: only touch confirmation fields (do not resurrect
  // a cancelled appointment).
  const update: Record<string, unknown> = {
    confirmation_status: "confirmed",
    confirmation_responded_at: nowIso,
    updated_at: nowIso,
  };
  if (appt.status !== "cancelled" && appt.status !== "geannuleerd") {
    update.status = "confirmed";
  }

  const { error: updateErr } = await supabase
    .from("appointments")
    .update(update)
    .eq("id", appt.id);
  if (updateErr) return json(500, { error: "update_failed" });

  try {
    await supabase.from("automation_logs").insert({
      user_id: appt.user_id,
      event_type: "appointment_confirmed",
      status: "success",
      customer_id: appt.customer_id,
      is_demo: appt.is_demo,
      message: "Klant bevestigde afspraak via publieke link",
      metadata: {
        source: "appointment-confirm",
        appointment_id: appt.id,
        channel: "public_link",
        response: "confirmed",
      },
    });
  } catch (_) { /* non-fatal */ }

  return json(200, {
    appointment: { ...publicAppt, confirmation_status: "confirmed", confirmation_responded_at: nowIso },
  });
});
