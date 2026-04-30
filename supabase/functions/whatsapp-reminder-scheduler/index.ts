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
      .select("user_id, enabled, send_reminders, send_review_request, send_no_show_followup, reminder_hours_before")
      .eq("enabled", true);
    if (sErr) throw sErr;

    const now = new Date();
    const WINDOW_MIN = 15; // ±15 minutes

    for (const s of settingsList || []) {
      // -------- REMINDER PASS --------
      if (!s.send_reminders) {
        // skip reminder pass for this salon
      } else {
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

        // Load reminder template (per-salon)
        const { data: tpl } = await admin
          .from("whatsapp_templates")
          .select("content, is_active")
          .eq("user_id", s.user_id)
          .eq("template_type", "reminder")
          .maybeSingle();

        const DEFAULT_REMINDER = `Hi {{customer_name}} 👋\n\nHerinnering: je afspraak bij {{salon_name}} is op {{appointment_date}} om {{appointment_time}}.\n\nTot dan!`;
        const templateContent = (tpl?.is_active === false ? null : tpl?.content) || DEFAULT_REMINDER;

        const message = templateContent
          .replace(/\{\{\s*customer_name\s*\}\}/g, customer.name || "")
          .replace(/\{\{\s*salon_name\s*\}\}/g, salonName)
          .replace(/\{\{\s*appointment_date\s*\}\}/g, dateStr)
          .replace(/\{\{\s*appointment_time\s*\}\}/g, timeStr)
          .replace(/\{\{\s*services\s*\}\}/g, "")
          .replace(/\{\{\s*reschedule_link\s*\}\}/g, "")
          .replace(/\{\{\s*review_link\s*\}\}/g, "");

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
          if (resp.ok && (data.success || data.deduped)) {
            if (data.deduped) stats.skipped++; else stats.sent++;
          } else {
            stats.failed++;
            stats.errors.push(`appt ${appt.id}: ${data.error || resp.status}`);
          }
        } catch (e) {
          stats.failed++;
          stats.errors.push(`appt ${appt.id}: ${e instanceof Error ? e.message : "unknown"}`);
        }
      }
      } // end reminder else-block

      // -------- REVIEW PASS --------
      if (s.send_review_request) {
        try {
          const { data: salonSettings2 } = await admin
            .from("settings")
            .select("timezone")
            .eq("user_id", s.user_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const tz2 = salonSettings2?.timezone || DEFAULT_TZ;

          // Look at appointments that ended between 2h and 26h ago, status voltooid/completed
          const since = new Date(now.getTime() - 26 * 60 * 60 * 1000).toISOString();
          const until = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

          const { data: doneAppts } = await admin
            .from("appointments")
            .select("id, customer_id, appointment_date, start_time, status, user_id")
            .eq("user_id", s.user_id)
            .gte("appointment_date", since)
            .lte("appointment_date", until)
            .in("status", ["voltooid", "completed"]);

          // Load review template once
          const { data: revTpl } = await admin
            .from("whatsapp_templates")
            .select("content, is_active")
            .eq("user_id", s.user_id)
            .eq("template_type", "review")
            .maybeSingle();
          if (revTpl?.is_active === false) {
            // template disabled — skip review pass
          } else {
            const DEFAULT_REVIEW = `Bedankt voor je bezoek aan {{salon_name}}, {{customer_name}}!\n\nWe horen graag je ervaring. Laat hier een korte review achter:\n{{review_link}}`;
            const reviewContent = revTpl?.content || DEFAULT_REVIEW;

            const { data: profile2 } = await admin
              .from("profiles")
              .select("salon_name, google_review_url")
              .eq("user_id", s.user_id)
              .maybeSingle();
            const salonName2 = profile2?.salon_name || "ons salon";
            const reviewLink = (profile2 as any)?.google_review_url || "";

            for (const appt of doneAppts || []) {
              stats.checked++;
              if (!appt.customer_id) { stats.skipped++; continue; }

              const { data: existingLog } = await admin
                .from("whatsapp_logs")
                .select("id")
                .eq("appointment_id", appt.id)
                .eq("kind", "review")
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

              const apptInstant = new Date(appt.appointment_date);
              const dateStr = new Intl.DateTimeFormat("nl-NL", {
                timeZone: tz2, day: "numeric", month: "long",
              }).format(apptInstant);
              const timeStr = (appt.start_time as string | null)?.substring(0, 5)
                || String(appt.appointment_date).substring(11, 16);

              const message = reviewContent
                .replace(/\{\{\s*customer_name\s*\}\}/g, customer.name || "")
                .replace(/\{\{\s*salon_name\s*\}\}/g, salonName2)
                .replace(/\{\{\s*appointment_date\s*\}\}/g, dateStr)
                .replace(/\{\{\s*appointment_time\s*\}\}/g, timeStr)
                .replace(/\{\{\s*services\s*\}\}/g, "")
                .replace(/\{\{\s*reschedule_link\s*\}\}/g, "")
                .replace(/\{\{\s*review_link\s*\}\}/g, reviewLink);

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
                    kind: "review",
                    meta: { tz: tz2 },
                  }),
                });
                const data = await resp.json();
                if (resp.ok && (data.success || data.deduped)) {
                  if (data.deduped) stats.skipped++; else stats.sent++;
                } else {
                  stats.failed++;
                  stats.errors.push(`review ${appt.id}: ${data.error || resp.status}`);
                }
              } catch (e) {
                stats.failed++;
                stats.errors.push(`review ${appt.id}: ${e instanceof Error ? e.message : "unknown"}`);
              }
            }
          }
        } catch (e) {
          stats.errors.push(`review pass ${s.user_id}: ${e instanceof Error ? e.message : "unknown"}`);
        }
      }

      // -------- NO-SHOW PASS --------
      if (s.send_no_show_followup) {
        try {
          // Look at appointments scheduled in the last 24h with no-show status
          const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
          const until = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

          const { data: nsAppts } = await admin
            .from("appointments")
            .select("id, customer_id, appointment_date, start_time, status, user_id")
            .eq("user_id", s.user_id)
            .gte("appointment_date", since)
            .lte("appointment_date", until)
            .in("status", ["no-show", "no_show", "noshow", "niet_verschenen"]);

          const { data: nsTpl } = await admin
            .from("whatsapp_templates")
            .select("content, is_active")
            .eq("user_id", s.user_id)
            .eq("template_type", "no_show")
            .maybeSingle();

          if (nsTpl?.is_active === false) {
            // template disabled — skip
          } else {
            const DEFAULT_NS = `Hoi {{customer_name}},\n\nWe hebben je vandaag gemist bij {{salon_name}} 💜\nGeen zorgen — we plannen graag een nieuwe afspraak in. Laat het ons weten!\n\n{{salon_name}}`;
            const nsContent = nsTpl?.content || DEFAULT_NS;

            const { data: profileNs } = await admin
              .from("profiles")
              .select("salon_name")
              .eq("user_id", s.user_id)
              .maybeSingle();
            const salonNameNs = profileNs?.salon_name || "ons salon";

            for (const appt of nsAppts || []) {
              stats.checked++;
              if (!appt.customer_id) { stats.skipped++; continue; }

              const { data: existingLog } = await admin
                .from("whatsapp_logs")
                .select("id")
                .eq("appointment_id", appt.id)
                .eq("kind", "no_show")
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

              const apptInstant = new Date(appt.appointment_date);
              const dateStr = new Intl.DateTimeFormat("nl-NL", {
                day: "numeric", month: "long",
              }).format(apptInstant);
              const timeStr = (appt.start_time as string | null)?.substring(0, 5)
                || String(appt.appointment_date).substring(11, 16);

              const message = nsContent
                .replace(/\{\{\s*customer_name\s*\}\}/g, customer.name || "")
                .replace(/\{\{\s*salon_name\s*\}\}/g, salonNameNs)
                .replace(/\{\{\s*appointment_date\s*\}\}/g, dateStr)
                .replace(/\{\{\s*appointment_time\s*\}\}/g, timeStr)
                .replace(/\{\{\s*services\s*\}\}/g, "")
                .replace(/\{\{\s*reschedule_link\s*\}\}/g, "")
                .replace(/\{\{\s*review_link\s*\}\}/g, "");

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
                    kind: "no_show",
                  }),
                });
                const data = await resp.json();
                if (resp.ok && (data.success || data.deduped)) {
                  if (data.deduped) stats.skipped++; else stats.sent++;
                } else {
                  stats.failed++;
                  stats.errors.push(`no_show ${appt.id}: ${data.error || resp.status}`);
                }
              } catch (e) {
                stats.failed++;
                stats.errors.push(`no_show ${appt.id}: ${e instanceof Error ? e.message : "unknown"}`);
              }
            }
          }
        } catch (e) {
          stats.errors.push(`no_show pass ${s.user_id}: ${e instanceof Error ? e.message : "unknown"}`);
        }
      }
    }

    if (runId) {
      await admin.from("whatsapp_scheduler_runs").update({
        finished_at: new Date().toISOString(),
        checked: stats.checked, sent: stats.sent, skipped: stats.skipped, failed: stats.failed,
        meta: { windows: stats.windows, errors: stats.errors.slice(0, 20) },
      }).eq("id", runId);
    }

    return new Response(JSON.stringify({ success: true, ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("scheduler error", err);
    if (runId) {
      await admin.from("whatsapp_scheduler_runs").update({
        finished_at: new Date().toISOString(),
        checked: stats.checked, sent: stats.sent, skipped: stats.skipped, failed: stats.failed,
        meta: { error: err instanceof Error ? err.message : "unknown" },
      }).eq("id", runId);
    }
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : "unknown", ...stats }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
