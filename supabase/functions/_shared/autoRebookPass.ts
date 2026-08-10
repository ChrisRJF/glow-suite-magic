/**
 * AUTO REBOOK SWEEP — the single Auto Rebook send pass.
 *
 * Runs inside the existing whatsapp-reminder-scheduler tick. There is no
 * second scheduler. Scale properties:
 *   - fair, resumable round-robin over salons (keyset cursor)
 *   - keyset-paginated customer batches per salon (no silent .limit(500))
 *   - history is loaded only for the customers in the current batch
 *   - a tick does not have to finish a salon; the next tick resumes
 */
import { calculateAutoRebook } from "./autoRebook.ts";
import { publicAppOrigin, selectChannel } from "./reminderEngine.ts";
import { getDefaultMessageTemplate, normalizeMessageLang, renderMessage } from "./messageTranslations.ts";
import { maskContact, retentionAllowed } from "./autoRebookGuards.ts";

export const SALONS_PER_TICK = 25;
export const CUSTOMERS_PER_BATCH = 200;
export const MAX_SENDS_PER_TICK = 120;
/** Auto Rebook booking links stay usable for two months. */
export const TOKEN_TTL_DAYS = 60;

const SALON_CURSOR = "auto_rebook_salon";
const custCursorKey = (uid: string) => `auto_rebook_cust:${uid}`;

type Admin = any;

async function getCursor(admin: Admin, name: string): Promise<string | null> {
  const { data } = await admin.rpc("get_scheduler_cursor", { _name: name });
  return (data as string) || null;
}
async function setCursor(admin: Admin, name: string, value: string | null) {
  await admin.rpc("set_scheduler_cursor", { _name: name, _value: value });
}

export interface SweepStats {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
  windows: Array<Record<string, unknown>>;
}

export interface SweepDeps {
  admin: Admin;
  supabaseUrl: string;
  serviceKey: string;
  now: Date;
  stats: SweepStats;
  /** salons with enabled=true and send_revenue_boost=true */
  salonIds: string[];
  /** per-salon monthly cap + AI autopilot gate */
  configFor: (userId: string) => { maxPerMonth: number };
  aiGate: (userId: string) => Promise<boolean>;
  getLocalHour: (tz: string) => number;
}

export async function runAutoRebookSweep(deps: SweepDeps): Promise<void> {
  const { admin, supabaseUrl, serviceKey, now, stats } = deps;
  const ordered = [...deps.salonIds].sort();
  if (ordered.length === 0) return;

  // ---- FAIRNESS: resume round-robin after the last salon of the previous tick.
  const salonCursor = await getCursor(admin, SALON_CURSOR);
  let start = 0;
  if (salonCursor) {
    const idx = ordered.findIndex((id) => id > salonCursor);
    start = idx === -1 ? 0 : idx;
  }
  const rotated = [...ordered.slice(start), ...ordered.slice(0, start)];
  const slice = rotated.slice(0, SALONS_PER_TICK);

  let sendsThisTick = 0;
  let lastSalon: string | null = null;

  for (const userId of slice) {
    lastSalon = userId;
    if (sendsThisTick >= MAX_SENDS_PER_TICK) break;
    try {
      if (!(await deps.aiGate(userId))) {
        stats.windows.push({ user_id: userId, pass: "auto_rebook", skipped_reason: "ai_mode_not_autopilot" });
        continue;
      }
      const processed = await processSalon(deps, userId, MAX_SENDS_PER_TICK - sendsThisTick);
      sendsThisTick += processed;
    } catch (e) {
      stats.errors.push(`auto_rebook pass ${userId}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  // Resume from here next tick, so the tail of the salon list is never starved.
  if (lastSalon) await setCursor(admin, SALON_CURSOR, lastSalon);
  void now;
}

async function processSalon(deps: SweepDeps, userId: string, sendBudget: number): Promise<number> {
  const { admin, supabaseUrl, serviceKey, now, stats } = deps;

  const { data: salonCfg } = await admin
    .from("settings")
    .select("timezone, public_slug, email_enabled, is_demo, demo_mode")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tz = salonCfg?.timezone || "Europe/Amsterdam";
  if (salonCfg?.is_demo || salonCfg?.demo_mode) {
    stats.windows.push({ user_id: userId, pass: "auto_rebook", skipped_reason: "demo_account" });
    return 0;
  }
  const localHour = deps.getLocalHour(tz);
  if (localHour < 9 || localHour >= 19) {
    stats.windows.push({ user_id: userId, pass: "auto_rebook", skipped_reason: "outside_local_hours", tz });
    return 0;
  }

  const { data: tpl } = await admin
    .from("whatsapp_templates").select("content, is_active")
    .eq("user_id", userId).eq("template_type", "revenue_boost").maybeSingle();
  if (tpl?.is_active === false) {
    stats.windows.push({ user_id: userId, pass: "auto_rebook", skipped_reason: "template_disabled" });
    return 0;
  }

  const [{ data: profile }, { data: svcRows }] = await Promise.all([
    admin.from("profiles").select("salon_name").eq("user_id", userId).maybeSingle(),
    admin.from("services").select("id, name, price, rebook_interval_days, is_active").eq("user_id", userId),
  ]);
  const salonName = profile?.salon_name || "ons salon";
  const serviceIntervals: Record<string, number | null> = {};
  const servicePrices: Record<string, number | null> = {};
  const serviceNames: Record<string, string> = {};
  for (const svc of svcRows || []) {
    serviceIntervals[svc.id] = svc.rebook_interval_days ?? null;
    servicePrices[svc.id] = Number(svc.price ?? 0) || null;
    serviceNames[svc.id] = svc.name || "";
  }

  const maxPerMonth = Math.max(1, deps.configFor(userId).maxPerMonth);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const origin = publicAppOrigin();
  const slug = salonCfg?.public_slug || null;
  const salonEmailEnabled = Boolean(salonCfg?.email_enabled ?? true);

  // ---- KEYSET PAGINATION over customers (no silent truncation) ----
  const cursorName = custCursorKey(userId);
  let cursor = await getCursor(admin, cursorName);
  let query = admin
    .from("customers")
    .select("id, name, phone, email, whatsapp_opt_in, preferred_language")
    .eq("user_id", userId)
    .eq("is_demo", false)
    .order("id", { ascending: true })
    .limit(CUSTOMERS_PER_BATCH);
  if (cursor) query = query.gt("id", cursor);
  const { data: batch } = await query;
  const candidates = batch || [];

  if (candidates.length === 0) {
    // End of the salon reached — restart from the beginning next sweep.
    await setCursor(admin, cursorName, null);
    return 0;
  }
  const exhausted = candidates.length < CUSTOMERS_PER_BATCH;
  await setCursor(admin, cursorName, exhausted ? null : candidates[candidates.length - 1].id);

  const ids = candidates.map((c: any) => c.id);

  // History and preferences are fetched only for this batch.
  const histSince = new Date(now.getTime() - 730 * 86_400_000).toISOString();
  const [{ data: apptRows }, { data: prefRows }, { data: monthLogs }] = await Promise.all([
    admin.from("appointments")
      .select("id, customer_id, service_id, appointment_date, status, price")
      .eq("user_id", userId).in("customer_id", ids).gte("appointment_date", histSince),
    admin.from("customer_message_preferences")
      .select("customer_id, email_opt_out, whatsapp_opt_out, retention_opt_out")
      .eq("user_id", userId).in("customer_id", ids),
    admin.from("whatsapp_logs")
      .select("customer_id").eq("user_id", userId).eq("kind", "auto_rebook")
      .in("status", ["sent", "demo"]).gte("created_at", monthStart).in("customer_id", ids),
  ]);

  const byCustomer = new Map<string, any[]>();
  for (const a of apptRows || []) {
    if (!a.customer_id) continue;
    const arr = byCustomer.get(a.customer_id) || [];
    arr.push(a);
    byCustomer.set(a.customer_id, arr);
  }
  const prefMap = new Map<string, any>();
  for (const p of prefRows || []) prefMap.set(p.customer_id, p);
  const sentThisMonth = new Map<string, number>();
  for (const l of monthLogs || []) {
    if (!l.customer_id) continue;
    sentThisMonth.set(l.customer_id, (sentThisMonth.get(l.customer_id) || 0) + 1);
  }

  let sent = 0;
  for (const c of candidates) {
    if (sent >= sendBudget) break;
    stats.checked++;

    const pref = prefMap.get(c.id);
    // ---- RETENTION CONSENT: checked before every single send ----
    if (!retentionAllowed(pref)) {
      stats.skipped++;
      stats.windows.push({ user_id: userId, customer_id: c.id, pass: "auto_rebook", skipped_reason: "retention_opt_out" });
      continue;
    }

    const decision = calculateAutoRebook({
      customer_id: c.id,
      appointments: byCustomer.get(c.id) || [],
      serviceIntervals,
      servicePrices,
      now,
    });
    if (!decision.should_rebook) { stats.skipped++; continue; }
    if ((sentThisMonth.get(c.id) || 0) >= maxPerMonth) { stats.skipped++; continue; }

    const chan = selectChannel({
      customer: { phone: c.phone, email: c.email, whatsapp_opt_in: pref?.whatsapp_opt_out ? false : c.whatsapp_opt_in },
      waEnabled: true,
      emailEnabled: salonEmailEnabled && !pref?.email_opt_out,
    });
    if (!chan.channel) {
      stats.skipped++;
      stats.windows.push({ user_id: userId, customer_id: c.id, pass: "auto_rebook", skipped_reason: chan.reason });
      continue;
    }

    // ---- STABLE CYCLE CLAIM: one cycle per completed visit ----
    const { data: claimData, error: claimErr } = await admin.rpc("claim_auto_rebook", {
      _user_id: userId,
      _customer_id: c.id,
      _service_id: decision.service_id,
      _expected_return_date: decision.expected_return_date,
      _days_overdue: decision.days_overdue,
      _reason: decision.reason,
      _estimated_value: decision.estimated_value,
      _is_demo: false,
      _last_appointment_id: decision.last_appointment_id,
      _token_ttl_days: TOKEN_TTL_DAYS,
    });
    if (claimErr) { stats.errors.push(`auto_rebook claim ${c.id}: ${claimErr.message}`); continue; }
    const claim = Array.isArray(claimData) ? claimData[0] : claimData;
    if (!claim?.id) {
      stats.skipped++;
      stats.windows.push({ user_id: userId, customer_id: c.id, pass: "auto_rebook", skipped_reason: "already_claimed" });
      continue;
    }

    const bookingLink = slug
      ? `${origin}/boeken/${slug}?rb=${claim.rebook_token}${decision.service_id ? `&svc=${decision.service_id}` : ""}`
      : `${origin}/boeken?rb=${claim.rebook_token}`;
    const lang = normalizeMessageLang(c.preferred_language || "nl");
    const message = renderMessage(tpl?.content || getDefaultMessageTemplate("reactivation", lang, "whatsapp"), {
      customer_name: c.name || "",
      salon_name: salonName,
      booking_link: bookingLink,
    });
    const meta = {
      rebook_action_id: claim.id,
      expected_return_date: decision.expected_return_date,
      last_appointment_id: decision.last_appointment_id,
      days_overdue: decision.days_overdue,
      interval_days: decision.recommended_interval_days,
      interval_source: decision.interval_source,
      reason: decision.reason,
      booking_link: bookingLink,
      tz,
    };

    if (chan.channel === "whatsapp") {
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            user_id: userId, to: c.phone, message, customer_id: c.id,
            kind: "auto_rebook", reminder_type: "auto_rebook", meta,
          }),
        });
        const data = await resp.json();
        if (resp.ok && (data.success || data.deduped)) {
          if (data.deduped) stats.skipped++; else { stats.sent++; sent++; }
          await admin.from("rebook_actions").update({
            status: "verzonden", channel: "whatsapp", sent_at: new Date().toISOString(),
          }).eq("id", claim.id);
          sentThisMonth.set(c.id, (sentThisMonth.get(c.id) || 0) + 1);
        } else {
          stats.failed++;
          await admin.from("rebook_actions").update({ status: "retry", channel: "whatsapp" }).eq("id", claim.id);
          stats.errors.push(`auto_rebook ${maskContact(c.phone)}: ${data.error || resp.status}`);
        }
      } catch (e) {
        stats.failed++;
        await admin.from("rebook_actions").update({ status: "retry", channel: "whatsapp" }).eq("id", claim.id);
        stats.errors.push(`auto_rebook ${maskContact(c.phone)}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    } else {
      const ok = await sendRebookEmail(deps, {
        userId, salonName, slug, customer: c, lang, decision, serviceNames,
        claimId: claim.id, bookingLink, message, meta, fallbackReason: chan.reason,
      });
      if (ok) {
        stats.sent++; sent++;
        sentThisMonth.set(c.id, (sentThisMonth.get(c.id) || 0) + 1);
      } else {
        stats.failed++;
        // Release the claim so a later tick may retry this visit cycle.
        await admin.from("rebook_actions").delete().eq("id", claim.id);
      }
    }
  }

  return sent;
}

export async function sendRebookEmail(
  deps: Pick<SweepDeps, "admin" | "stats">,
  args: {
    userId: string; salonName: string; slug: string | null; customer: any; lang: string;
    decision: any; serviceNames: Record<string, string>; claimId: string;
    bookingLink: string; message: string; meta: Record<string, unknown>; fallbackReason?: string;
  },
): Promise<boolean> {
  const { admin } = deps;
  try {
    const res = await admin.functions.invoke("send-white-label-email", {
      body: {
        user_id: args.userId,
        salon_name: args.salonName,
        salon_slug: args.slug || undefined,
        recipient_email: args.customer.email,
        recipient_name: args.customer.name || "",
        template_key: "auto_rebook",
        idempotency_key: `auto-rebook-${args.claimId}`,
        language: args.lang,
        template_data: {
          customer_name: args.customer.name || "",
          salon_name: args.salonName,
          service_name: args.decision.service_id ? args.serviceNames[args.decision.service_id] || "" : "",
          last_visit_date: args.decision.last_appointment_date,
          rebook_url: args.bookingLink,
          booking_url: args.bookingLink,
        },
      },
    });
    if (res.error) throw new Error(res.error.message || "email_invoke_failed");

    await admin.from("rebook_actions").update({
      status: "verzonden", channel: "email", sent_at: new Date().toISOString(),
    }).eq("id", args.claimId);
    await admin.from("whatsapp_logs").insert({
      user_id: args.userId,
      customer_id: args.customer.id,
      to_number: `email:${maskContact(args.customer.email)}`,
      message: "[email] Auto Rebook",
      status: "sent",
      kind: "auto_rebook",
      reminder_type: "auto_rebook",
      meta: { ...args.meta, channel: "email", fallback_reason: args.fallbackReason },
    });
    return true;
  } catch (e) {
    deps.stats.errors.push(`auto_rebook email ${maskContact(args.customer.email)}: ${e instanceof Error ? e.message : "unknown"}`);
    return false;
  }
}
