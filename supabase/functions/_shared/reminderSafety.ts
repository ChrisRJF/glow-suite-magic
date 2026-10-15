// Reminder safety helpers: tenant-scoped lookups and exact-instant reminder
// windows. Used by sendAppointmentReminder.ts and whatsapp-reminder-scheduler.

// ---------- (1) Tenant scoping, fail closed ----------

export interface ScopedReminderRows<A, C, S> {
  ok: true;
  appt: A;
  customer: C;
  service: S | null;
}
export interface ScopedReminderFailure {
  ok: false;
  reason:
    | "appointment_not_found"
    | "no_customer"
    | "customer_not_found"
    | "tenant_mismatch"
    | "service_not_found"
    | "lookup_failed";
}

type Row = Record<string, unknown> & { id: string; user_id?: string | null };
// Minimal structural type of the service-role client used here.
// deno-lint-ignore no-explicit-any
type AdminLike = { from: (t: string) => any };

/**
 * Loads appointment, customer and (optional) service with the service-role
 * client, each filtered on the same tenant user_id, and re-checks user_id on
 * every returned row. Any error, missing row or mismatch fails closed, so the
 * caller must stop before claims or sends.
 */
export async function loadTenantScopedReminderRows(
  admin: AdminLike,
  userId: string,
  appointmentId: string,
  apptSelect: string,
  customerSelect: string,
): Promise<ScopedReminderRows<Row, Row, Row> | ScopedReminderFailure> {
  if (!userId || !appointmentId) return { ok: false, reason: "lookup_failed" };
  const one = async (table: string, select: string, id: string) => {
    const sel = select.includes("user_id") ? select : `${select}, user_id`;
    const { data, error } = await admin.from(table).select(sel).eq("id", id).eq("user_id", userId).maybeSingle();
    if (error) return { error: true as const, row: null };
    return { error: false as const, row: (data as Row | null) ?? null };
  };

  const a = await one("appointments", apptSelect, appointmentId);
  if (a.error) return { ok: false, reason: "lookup_failed" };
  if (!a.row) return { ok: false, reason: "appointment_not_found" };
  if (a.row.user_id !== userId) return { ok: false, reason: "tenant_mismatch" };
  const customerId = a.row.customer_id as string | null;
  if (!customerId) return { ok: false, reason: "no_customer" };

  const c = await one("customers", customerSelect, customerId);
  if (c.error) return { ok: false, reason: "lookup_failed" };
  // Not found under this tenant = belongs to another salon or deleted.
  if (!c.row) return { ok: false, reason: "customer_not_found" };
  if (c.row.user_id !== userId) return { ok: false, reason: "tenant_mismatch" };

  let service: Row | null = null;
  const serviceId = a.row.service_id as string | null;
  if (serviceId) {
    const s = await one("services", "id, name", serviceId);
    if (s.error) return { ok: false, reason: "lookup_failed" };
    if (!s.row) return { ok: false, reason: "service_not_found" };
    if (s.row.user_id !== userId) return { ok: false, reason: "tenant_mismatch" };
    service = s.row;
  }
  return { ok: true, appt: a.row, customer: c.row, service };
}

// ---------- (2) Local salon date vs UTC, DST safe ----------

export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number }

export function localPartsOf(instant: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(instant).map((x) => [x.type, x.value]));
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: p.hour === "24" ? 0 : +p.hour, minute: +p.minute,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
export const localDateKey = (p: { year: number; month: number; day: number }) =>
  `${p.year}-${pad(p.month)}-${pad(p.day)}`;

/** Offset (ms) of timeZone at a given instant: local wall clock minus UTC. */
function offsetAt(instantMs: number, timeZone: string): number {
  const l = localPartsOf(new Date(instantMs), timeZone);
  return Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute) - Math.floor(instantMs / 60000) * 60000;
}

/**
 * UTC instant of a local wall-clock time. Two-pass offset resolution handles
 * DST: a nonexistent spring-forward time maps forward, an ambiguous
 * fall-back time maps to its first occurrence.
 */
export function localToUtc(local: LocalParts, timeZone: string): Date {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const o1 = offsetAt(guess - 0, timeZone);
  let ms = guess - o1;
  const o2 = offsetAt(ms, timeZone);
  if (o2 !== o1) {
    const alt = guess - o2;
    ms = offsetAt(alt, timeZone) === o2 ? Math.min(ms, alt) : Math.max(ms, alt);
  }
  return new Date(ms);
}

/** Add real elapsed minutes to a local time and re-project into timeZone. */
export function addMinutesLocal(local: LocalParts, minutes: number, timeZone: string): LocalParts {
  return localPartsOf(new Date(localToUtc(local, timeZone).getTime() + minutes * 60000), timeZone);
}

/** UTC query bounds [start, end) covering whole local days firstDate..lastDate. */
export function utcBoundsForLocalDays(firstDate: string, lastDate: string, timeZone: string) {
  const [y1, m1, d1] = firstDate.split("-").map(Number);
  const [y2, m2, d2] = lastDate.split("-").map(Number);
  const start = localToUtc({ year: y1, month: m1, day: d1, hour: 0, minute: 0 }, timeZone);
  const nextDay = new Date(Date.UTC(y2, m2 - 1, d2 + 1));
  const end = localToUtc({
    year: nextDay.getUTCFullYear(), month: nextDay.getUTCMonth() + 1, day: nextDay.getUTCDate(), hour: 0, minute: 0,
  }, timeZone);
  return { startIso: start.toISOString(), endIsoExclusive: end.toISOString() };
}

/** Local salon date of a stored appointment instant (replaces slice(0, 10)). */
export function appointmentLocalDate(appointmentDate: string, timeZone: string): string | null {
  const d = new Date(appointmentDate);
  if (Number.isNaN(d.getTime())) return null;
  return localDateKey(localPartsOf(d, timeZone));
}

/**
 * Reminder window as real elapsed time: target = now + hoursBefore, plus/minus
 * windowMin, compared on UTC instants (so repeated autumn wall times differ).
 * Query bounds are widened by one day each side because legacy rows store the
 * local wall clock as if it were UTC (later than the real instant by the
 * offset); the exact instant filter in inReminderWindow decides.
 */
export function reminderWindow(now: Date, hoursBefore: number, windowMin: number, timeZone: string) {
  const targetMs = now.getTime() + hoursBefore * 3600000;
  const startMs = targetMs - windowMin * 60000;
  const endMs = targetMs + windowMin * 60000;
  const lowDate = localDateKey(localPartsOf(new Date(startMs), timeZone));
  const highDate = localDateKey(localPartsOf(new Date(endMs), timeZone));
  return {
    lowDate, highDate, startMs, endMs,
    startIso: new Date(startMs - 86400000).toISOString(),
    endIsoExclusive: new Date(endMs + 86400000 + 1).toISOString(),
  };
}

const hhmm = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

/**
 * Real start instant of an appointment. Storage is mixed:
 * - canonical: appointment_date is the real UTC instant, start_time its local HH:mm;
 * - legacy: appointment_date holds the local wall clock written as UTC.
 * Legacy wall times that do not exist (spring gap) or occur twice (autumn
 * repeat) cannot be resolved and return null (fail closed, no reminder).
 */
export function appointmentStartInstant(
  appointmentDate: string, startTime: string | null | undefined, timeZone: string,
): { kind: "canonical" | "legacy"; ms: number } | null {
  const d = new Date(appointmentDate);
  if (Number.isNaN(d.getTime()) || !startTime) return null;
  const st = startTime.slice(0, 5);
  const l = localPartsOf(d, timeZone);
  if (hhmm(l.hour, l.minute) === st) return { kind: "canonical", ms: d.getTime() };
  if (hhmm(d.getUTCHours(), d.getUTCMinutes()) !== st) return null;
  const wall: LocalParts = {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(),
  };
  const key = (p: LocalParts) => `${localDateKey(p)} ${hhmm(p.hour, p.minute)}`;
  const ms = localToUtc(wall, timeZone).getTime();
  if (key(localPartsOf(new Date(ms), timeZone)) !== key(wall)) return null; // gap
  for (const alt of [ms - 3600000, ms + 3600000]) {
    if (key(localPartsOf(new Date(alt), timeZone)) === key(wall)) return null; // repeated
  }
  return { kind: "legacy", ms };
}

export function inReminderWindow(
  w: ReturnType<typeof reminderWindow>,
  appointmentDate: string,
  startTime: string | null | undefined,
  timeZone: string,
): boolean {
  const inst = appointmentStartInstant(appointmentDate, startTime, timeZone);
  return !!inst && inst.ms >= w.startMs && inst.ms <= w.endMs;
}

/**
 * Scheduler verdict for one candidate row. Unresolvable times (missing
 * start_time, legacy DST gap/repeat, start_time matching neither storage
 * form) are reported only when the row's plausible slot touches the window,
 * so the skip reason is recorded once per affected run, not for every row.
 */
export function classifyReminderCandidate(
  w: ReturnType<typeof reminderWindow>,
  appointmentDate: string,
  startTime: string | null | undefined,
  timeZone: string,
): "in_window" | "out_of_window" | "missing_start_time" | "unresolvable_time" {
  const d = new Date(appointmentDate);
  if (Number.isNaN(d.getTime())) return "out_of_window";
  const inst = appointmentStartInstant(appointmentDate, startTime, timeZone);
  if (inst) return inst.ms >= w.startMs && inst.ms <= w.endMs ? "in_window" : "out_of_window";
  // Could this row plausibly be in the window? Either as real instant or as
  // legacy wall clock (real instant up to 14h earlier than stored).
  const ms = d.getTime();
  const near = ms >= w.startMs - 14 * 3600000 && ms <= w.endMs + 14 * 3600000;
  if (!near) return "out_of_window";
  return startTime ? "unresolvable_time" : "missing_start_time";
}
