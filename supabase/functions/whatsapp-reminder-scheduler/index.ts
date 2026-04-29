import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_TZ = "Europe/Amsterdam";

// Get the wall-clock time in a given IANA timezone as discrete parts.
function getLocalParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === "24" ? "00" : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

// Add minutes to a {y,m,d,h,min} struct via Date arithmetic in UTC space, then
// re-project back into the target timezone. This is DST-safe because we add
// real elapsed minutes, not calendar hours.
function addMinutesLocal(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  minutes: number,
  timeZone: string,
) {
  // Treat the local parts as if they were UTC to get a stable reference point
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0);
  // Find the offset that timezone has at that wall-clock moment by round-trip
  const refDate = new Date(asUtc);
  const projected = getLocalParts(refDate, timeZone);
  const projectedUtc = Date.UTC(
    projected.year,
    projected.month - 1,
    projected.day,
    projected.hour,
    projected.minute,
    0,
  );
  const offsetMs = asUtc - projectedUtc; // local - tz(local) ≈ tz offset
  // Actual UTC instant for the original local wall-clock:
  const instantUtc = asUtc - offsetMs + minutes * 60 * 1000;
  // Re-project back to local
  return getLocalParts(new Date(instantUtc), timeZone);
}

function pad(n: number) { return n.toString().padStart(2, "0"); }
function fmtDate(p: { year: number; month: number; day: number }) {
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
function fmtTime(p: { hour: number; minute: number }) {
  return `${pad(p.hour)}:${pad(p.minute)}:00`;
}
function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const stats = {
    checked: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
    windows: [] as Array<Record<string, unknown>>,
  };

  // Record run start
  const { data: runRow } = await admin
    .from("whatsapp_scheduler_runs")
    .insert({ started_at: new Date().toISOString() })
    .select("id")
    .maybeSingle();
  const runId = runRow?.id || null;

  try {
    const { data: settingsList, error: sErr } = await admin
      .from("whatsapp_settings")
      .select("user_id, enabled, send_reminders, reminder_hours_before")
      .eq("enabled", true)
      .eq("send_reminders", true);
    if (sErr) throw sErr;

    const now = new Date();
    const WINDOW_MIN = 15; // ±15 minutes

    for (const s of settingsList || []) {
      const hoursBefore = s.reminder_hours_before || 24;

      // Resolve salon timezone
      const { data: salonSettings } = await admin
        .from("settings")
        .select("timezone")
        .eq("user_id", s.user_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const tz = salonSettings?.timezone || DEFAULT_TZ;

      // Current local wall-clock for the salon
      const nowLocal = getLocalParts(now, tz);
      // Target local wall-clock = now_local + hoursBefore
      const targetLocal = addMinutesLocal(nowLocal, hoursBefore * 60, tz);
      const lowLocal = addMinutesLocal(targetLocal, -WINDOW_MIN, tz);
      const highLocal = addMinutesLocal(targetLocal, WINDOW_MIN, tz);

      const targetDate = fmtDate(targetLocal);
      const lowMin = timeToMinutes(fmtTime(lowLocal));
      const highMin = timeToMinutes(fmtTime(highLocal));
      const crossesMidnight = fmtDate(lowLocal) !== fmtDate(highLocal);

      const windowInfo = {
        user_id: s.user_id,
        tz,
        hours_before: hoursBefore,
        now_local: `${fmtDate(nowLocal)} ${fmtTime(nowLocal)}`,
        target_local: `${fmtDate(targetLocal)} ${fmtTime(targetLocal)}`,
        window_local_start: `${fmtDate(lowLocal)} ${fmtTime(lowLocal)}`,
        window_local_end: `${fmtDate(highLocal)} ${fmtTime(highLocal)}`,
      };
      stats.windows.push(windowInfo);

      // Query appointments by local date (broad), then filter by start_time minutes
      const dates = crossesMidnight ? [fmtDate(lowLocal), fmtDate(highLocal)] : [targetDate];
      const startOfDay = `${dates[0]}T00:00:00Z`;
      const endOfDay = `${dates[dates.length - 1]}T23:59:59Z`;

      const { data: appts, error: aErr } = await admin
        .from("appointments")
        .select("id, customer_id, appointment_date, start_time, status, user_id")
        .eq("user_id", s.user_id)
        .gte("appointment_date", startOfDay)
        .lte("appointment_date", endOfDay)
        .in("status", ["confirmed", "gepland", "pending_confirmation"]);
      if (aErr) {
        stats.errors.push(`appts ${s.user_id}: ${aErr.message}`);
        continue;
      }

      for (const appt of appts || []) {
        // Filter by local start_time minutes within window
        const apptDateOnly = String(appt.appointment_date).slice(0, 10);
        const startTime = (appt.start_time as string | null) || String(appt.appointment_date).substring(11, 16);
        if (!startTime) { stats.skipped++; continue; }
        const apptMin = timeToMinutes(startTime);

        let inWindow = false;
        if (crossesMidnight) {
          if (apptDateOnly === fmtDate(lowLocal) && apptMin >= lowMin) inWindow = true;
          if (apptDateOnly === fmtDate(highLocal) && apptMin <= highMin) inWindow = true;
        } else {
          if (apptDateOnly === targetDate && apptMin >= lowMin && apptMin <= highMin) inWindow = true;
        }
        if (!inWindow) continue;

        stats.checked++;
        if (!appt.customer_id) { stats.skipped++; continue; }

        // Dedup
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

        const { data: profile } = await admin
          .from("profiles")
          .select("salon_name")
          .eq("user_id", s.user_id)
          .maybeSingle();
        const salonName = profile?.salon_name || "ons salon";

        // Format using salon timezone for display
        const apptInstant = new Date(appt.appointment_date);
        const localApptParts = getLocalParts(apptInstant, tz);
        const dateStr = new Intl.DateTimeFormat("nl-NL", {
          timeZone: tz, day: "numeric", month: "long",
        }).format(apptInstant);
        const timeStr = startTime.substring(0, 5);
        const localApptStr = `${fmtDate(localApptParts)} ${timeStr} (${tz})`;

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
              meta: {
                local_appointment: localApptStr,
                scheduler_window: `${windowInfo.window_local_start} → ${windowInfo.window_local_end}`,
                tz,
              },
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
