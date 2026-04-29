import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const stats = { checked: 0, sent: 0, skipped: 0, failed: 0, errors: [] as string[] };

  try {
    // Find all users with reminders enabled
    const { data: settingsList, error: sErr } = await admin
      .from("whatsapp_settings")
      .select("user_id, enabled, send_reminders, reminder_hours_before")
      .eq("enabled", true)
      .eq("send_reminders", true);
    if (sErr) throw sErr;

    const now = new Date();

    for (const s of settingsList || []) {
      const hoursBefore = s.reminder_hours_before || 24;
      // Window: appointments between (now + hoursBefore - 15min) and (now + hoursBefore + 15min)
      const targetCenter = new Date(now.getTime() + hoursBefore * 3600 * 1000);
      const windowStart = new Date(targetCenter.getTime() - 15 * 60 * 1000);
      const windowEnd = new Date(targetCenter.getTime() + 15 * 60 * 1000);

      const { data: appts, error: aErr } = await admin
        .from("appointments")
        .select("id, customer_id, appointment_date, start_time, status, user_id")
        .eq("user_id", s.user_id)
        .gte("appointment_date", windowStart.toISOString())
        .lte("appointment_date", windowEnd.toISOString())
        .in("status", ["confirmed", "gepland", "pending_confirmation"]);
      if (aErr) {
        stats.errors.push(`appts ${s.user_id}: ${aErr.message}`);
        continue;
      }

      for (const appt of appts || []) {
        stats.checked++;

        if (!appt.customer_id) { stats.skipped++; continue; }

        // Check if reminder already sent
        const { data: existingLog } = await admin
          .from("whatsapp_logs")
          .select("id")
          .eq("appointment_id", appt.id)
          .eq("kind", "reminder")
          .eq("status", "sent")
          .limit(1)
          .maybeSingle();
        if (existingLog) { stats.skipped++; continue; }

        const { data: customer } = await admin
          .from("customers")
          .select("id, name, phone, whatsapp_opt_in")
          .eq("id", appt.customer_id)
          .maybeSingle();
        if (!customer || !customer.phone || customer.whatsapp_opt_in === false) {
          stats.skipped++;
          continue;
        }

        // Get salon name
        const { data: profile } = await admin
          .from("profiles")
          .select("salon_name")
          .eq("user_id", s.user_id)
          .maybeSingle();
        const salonName = profile?.salon_name || "ons salon";

        const apptDate = new Date(appt.appointment_date);
        const dateStr = apptDate.toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
        const timeStr = (appt.start_time || apptDate.toISOString().substring(11, 16)).substring(0, 5);
        const message = `Hi ${customer.name}, herinnering: je afspraak bij ${salonName} is op ${dateStr} om ${timeStr}. Tot dan! Antwoord met JA om te bevestigen of NEE om te annuleren.`;

        try {
          const fnUrl = `${SUPABASE_URL}/functions/v1/whatsapp-send`;
          const resp = await fetch(fnUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SERVICE_KEY}`,
            },
            body: JSON.stringify({
              user_id: s.user_id,
              to: customer.phone,
              message,
              customer_id: customer.id,
              appointment_id: appt.id,
              kind: "reminder",
            }),
          });
          const data = await resp.json();
          if (resp.ok && data.success) {
            stats.sent++;
          } else {
            stats.failed++;
            stats.errors.push(`appt ${appt.id}: ${data.error || resp.status}`);
          }
        } catch (e) {
          stats.failed++;
          stats.errors.push(`appt ${appt.id}: ${e instanceof Error ? e.message : "unknown"}`);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("scheduler error", err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : "unknown", ...stats }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
