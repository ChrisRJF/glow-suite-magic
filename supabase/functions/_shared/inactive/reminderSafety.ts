// Prepared (inactive) reminder safety helpers. NOT imported by any entrypoint
// yet: wiring them into sendAppointmentReminder.ts and
// whatsapp-reminder-scheduler/index.ts auto-deploys, so that needs a separate GO.
// See docs/prepared-patches/reminder-safety/README.md.

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
 * Reminder window, same semantics as the scheduler: target = now + hoursBefore,
 * plus/minus windowMin, compared on local date + local start_time minutes.
 */
export function reminderWindow(now: Date, hoursBefore: number, windowMin: number, timeZone: string) {
  const nowLocal = localPartsOf(now, timeZone);
  const target = addMinutesLocal(nowLocal, hoursBefore * 60, timeZone);
  const low = addMinutesLocal(target, -windowMin, timeZone);
  const high = addMinutesLocal(target, windowMin, timeZone);
  const lowDate = localDateKey(low);
  const highDate = localDateKey(high);
  return {
    lowDate, highDate, lowMin: low.hour * 60 + low.minute, highMin: high.hour * 60 + high.minute,
    ...utcBoundsForLocalDays(lowDate, highDate, timeZone),
  };
}

export function inReminderWindow(
  w: ReturnType<typeof reminderWindow>,
  appointmentDate: string,
  startTime: string,
  timeZone: string,
): boolean {
  const date = appointmentLocalDate(appointmentDate, timeZone);
  if (!date || !startTime) return false;
  const [h, m] = startTime.split(":").map(Number);
  const min = h * 60 + (m || 0);
  if (w.lowDate !== w.highDate) {
    return (date === w.lowDate && min >= w.lowMin) || (date === w.highDate && min <= w.highMin);
  }
  return date === w.lowDate && min >= w.lowMin && min <= w.highMin;
}
