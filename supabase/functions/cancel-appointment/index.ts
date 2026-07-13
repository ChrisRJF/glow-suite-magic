// Authenticated cancellation endpoint. All salon-side callers (dashboard, agenda,
// reception) should invoke this so cancellations go through the canonical service.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";
import { cancelAppointmentCanonical, type CancelSource } from "../_shared/cancelAppointment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  appointment_id: z.string().uuid(),
  source: z.enum(["salon_dashboard", "salon_agenda", "reception", "system", "api"]).optional(),
  reason: z.string().max(500).optional(),
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { error: "unauthorized" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await anonClient.auth.getUser();
  if (userErr || !userRes?.user) return json(401, { error: "unauthorized" });
  const user = userRes.user;

  let payload: unknown;
  try { payload = await req.json(); } catch { return json(400, { error: "invalid_json" }); }
  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) return json(400, { error: "invalid_request" });

  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Ownership guard: the appointment must belong to this authenticated user.
  const { data: owned } = await admin
    .from("appointments")
    .select("id, user_id")
    .eq("id", parsed.data.appointment_id)
    .maybeSingle();
  if (!owned) return json(404, { error: "not_found" });
  if (owned.user_id !== user.id) return json(403, { error: "forbidden" });

  const result = await cancelAppointmentCanonical(admin, {
    appointmentId: parsed.data.appointment_id,
    source: (parsed.data.source ?? "salon_agenda") as CancelSource,
    actorUserId: user.id,
    reason: parsed.data.reason ?? null,
  });

  return json(200, result);
});
