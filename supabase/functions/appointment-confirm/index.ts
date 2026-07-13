import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get"), token: z.string().min(6).max(200) }),
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
      ? supabase.from("customers").select("name").eq("id", appt.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    appt.service_id
      ? supabase.from("services").select("name").eq("id", appt.service_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

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

  if (expired) return json(410, { error: "expired", appointment: publicAppt });

  const desired = parsed.data.response === "confirm" ? "confirmed" : "declined";

  // Idempotent: if already same, just return current state
  if (appt.confirmation_status === desired) {
    return json(200, { appointment: publicAppt, already: true });
  }

  const update: Record<string, unknown> = {
    confirmation_status: desired,
    confirmation_responded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (desired === "confirmed" && appt.status !== "cancelled") {
    update.status = "confirmed";
  } else if (desired === "declined") {
    update.status = "cancelled";
  }

  const { error: updateErr } = await supabase
    .from("appointments")
    .update(update)
    .eq("id", appt.id);

  if (updateErr) return json(500, { error: "update_failed" });

  // Log to automation_logs (best-effort)
  try {
    await supabase.from("automation_logs").insert({
      user_id: appt.user_id,
      channel: "public_link",
      event_type: desired === "confirmed" ? "appointment_confirmed" : "appointment_declined",
      status: "success",
      appointment_id: appt.id,
      customer_id: appt.customer_id,
      is_demo: appt.is_demo,
      metadata: {
        source: "appointment-confirm",
        token: parsed.data.token,
        response: desired,
      },
    });
  } catch (_) {
    // non-fatal
  }

  return json(200, {
    appointment: { ...publicAppt, confirmation_status: desired, confirmation_responded_at: update.confirmation_responded_at as string },
  });
});
