/**
 * Canonical Auto Rebook guards.
 *
 * Every Auto Rebook send — scheduler, manual send, retry and dead-letter
 * fallback — MUST pass through these checks. There is no second gate.
 *
 * Writers of `rebook_actions` (documented, complete list):
 *   1. public.claim_auto_rebook()          — the only INSERT path (claim)
 *   2. whatsapp-reminder-scheduler         — lifecycle status/channel updates
 *   3. auto-rebook-send                    — lifecycle status/channel updates
 *   4. public-booking                      — attribution on conversion
 *   5. public.sync_rebook_revenue() trigger— realized / reversed revenue
 *   6. public.set_auto_rebook() RPC        — suppression on master toggle off
 * No other code may write to this table.
 */

export type SupabaseAdmin = {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => any;
};

export interface RetentionPreference {
  retention_opt_out?: boolean | null;
  email_opt_out?: boolean | null;
  whatsapp_opt_out?: boolean | null;
}

/**
 * Retention (marketing) consent is separate from transactional consent.
 * A customer can keep receiving appointment reminders while refusing
 * Auto Rebook messages.
 */
export function retentionAllowed(pref?: RetentionPreference | null): boolean {
  return !pref?.retention_opt_out;
}

/** Master toggle state: WhatsApp setting AND template must both be active. */
export async function autoRebookEnabled(admin: SupabaseAdmin, userId: string): Promise<boolean> {
  const [{ data: ws }, { data: tpl }] = await Promise.all([
    admin.from("whatsapp_settings").select("enabled, send_revenue_boost").eq("user_id", userId).maybeSingle(),
    admin.from("whatsapp_templates").select("is_active").eq("user_id", userId).eq("template_type", "revenue_boost").maybeSingle(),
  ]);
  if (!ws?.enabled || !ws?.send_revenue_boost) return false;
  if (tpl && tpl.is_active === false) return false;
  return true;
}

/** True when the customer already has a valid upcoming appointment. */
export async function hasFutureAppointment(
  admin: SupabaseAdmin,
  userId: string,
  customerId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("appointments")
    .select("id")
    .eq("user_id", userId)
    .eq("customer_id", customerId)
    .gte("appointment_date", new Date().toISOString())
    .not("status", "in", "(geannuleerd,cancelled,no_show,declined)")
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

export interface RetrySendability {
  allowed: boolean;
  reason: string;
}

/** Statuses in which a rebook cycle is closed and must never be sent again. */
const CLOSED_REBOOK_STATUSES = new Set([
  "geboekt",
  "booked",
  "gerealiseerd",
  "vervallen",
  "suppressed",
  "mislukt",
]);

/**
 * Cycle validity: the claim must still exist, still be open and its token must
 * not have expired. Without this a retry could deliver a link that the public
 * booking endpoint would refuse anyway.
 */
export async function rebookCycleStillValid(
  admin: SupabaseAdmin,
  rebookActionId: string,
): Promise<RetrySendability> {
  const { data } = await admin
    .from("rebook_actions")
    .select("id, status, booked_at, token_expires_at")
    .eq("id", rebookActionId)
    .maybeSingle();

  if (!data?.id) return { allowed: false, reason: "rebook_action_missing" };
  if (data.booked_at) return { allowed: false, reason: "cycle_already_booked" };
  if (CLOSED_REBOOK_STATUSES.has(String(data.status || "").toLowerCase())) {
    return { allowed: false, reason: `cycle_${String(data.status).toLowerCase()}` };
  }
  if (data.token_expires_at && new Date(data.token_expires_at).getTime() <= Date.now()) {
    return { allowed: false, reason: "token_expired" };
  }
  return { allowed: true, reason: "ok" };
}

/**
 * Re-evaluated before EVERY retry. When any of these now blocks the send the
 * retry is suppressed — it is never counted as a delivery failure.
 */
export async function canStillSendRebook(
  admin: SupabaseAdmin,
  userId: string,
  customerId: string,
  rebookActionId?: string | null,
): Promise<RetrySendability> {
  if (!(await autoRebookEnabled(admin, userId))) return { allowed: false, reason: "auto_rebook_disabled" };

  const { data: pref } = await admin
    .from("customer_message_preferences")
    .select("retention_opt_out, email_opt_out, whatsapp_opt_out")
    .eq("user_id", userId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (!retentionAllowed(pref)) return { allowed: false, reason: "retention_opt_out" };
  if (pref?.whatsapp_opt_out && pref?.email_opt_out) return { allowed: false, reason: "all_channels_opted_out" };

  if (await hasFutureAppointment(admin, userId, customerId)) {
    return { allowed: false, reason: "customer_already_rebooked" };
  }

  if (rebookActionId) {
    const cycle = await rebookCycleStillValid(admin, rebookActionId);
    if (!cycle.allowed) return cycle;
  }
  return { allowed: true, reason: "ok" };
}


/** Masked identifier for operational logs — never full email or phone. */
export function maskContact(value?: string | null): string {
  const v = String(value || "");
  if (!v) return "";
  if (v.includes("@")) {
    const [user, domain] = v.split("@");
    return `${user.slice(0, 2)}***@${domain}`;
  }
  return `***${v.slice(-4)}`;
}
