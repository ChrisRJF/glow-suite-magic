/**
 * Canonical Auto Rebook engine (backend).
 *
 * MUST stay logic-identical to `src/lib/autoRebook.ts`.
 * Used by the WhatsApp reminder scheduler (Auto Rebook pass) and by
 * public-booking attribution. No other rebook formulas allowed.
 */

export const AUTO_REBOOK_FALLBACK_DAYS = 42;
export const AUTO_REBOOK_MIN_DAYS = 7;
export const AUTO_REBOOK_MAX_DAYS = 365;

const DAY_MS = 86_400_000;

/** Statuses that count as a real, completed visit. */
const COMPLETED_STATUSES = new Set(["voltooid", "completed", "afgerond", "done"]);
/** Statuses that never count (cancelled / no-show). */
const DEAD_STATUSES = new Set([
  "geannuleerd",
  "cancelled",
  "canceled",
  "no-show",
  "no_show",
  "noshow",
  "niet_verschenen",
  "declined",
]);
/** Statuses that count as an upcoming (future) booking. */
const UPCOMING_STATUSES = new Set([
  "gepland",
  "confirmed",
  "pending_confirmation",
  "bevestigd",
  "voltooid",
  "completed",
]);

export interface RebookAppointment {
  id?: string | null;
  service_id?: string | null;
  appointment_date: string; // ISO timestamp
  status?: string | null;
  price?: number | null;
}

export interface AutoRebookInput {
  customer_id: string;
  /** All appointments of this customer (past + future, any status). */
  appointments: RebookAppointment[];
  /** service_id -> services.rebook_interval_days */
  serviceIntervals?: Record<string, number | null | undefined>;
  /** service_id -> services.price (used for estimated value when appointment price is missing) */
  servicePrices?: Record<string, number | null | undefined>;
  /** Evaluation moment (defaults to now). */
  now?: Date | string | number;
}

export type IntervalSource = "service" | "history" | "fallback";

export interface AutoRebookDecision {
  should_rebook: boolean;
  customer_id: string;
  service_id: string | null;
  last_appointment_date: string | null;
  recommended_interval_days: number;
  interval_source: IntervalSource;
  /** yyyy-mm-dd */
  expected_return_date: string | null;
  days_overdue: number;
  reason: string;
  estimated_value: number | null;
}

function clampInterval(n: number): number {
  return Math.max(AUTO_REBOOK_MIN_DAYS, Math.min(AUTO_REBOOK_MAX_DAYS, Math.round(n)));
}

function toTime(v: string): number {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Start of the UTC day for a timestamp — keeps day math stable across runs. */
function startOfDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function isCompleted(a: RebookAppointment, nowMs: number): boolean {
  const status = String(a.status || "").toLowerCase();
  if (DEAD_STATUSES.has(status)) return false;
  const t = toTime(a.appointment_date);
  if (!Number.isFinite(t)) return false;
  if (COMPLETED_STATUSES.has(status)) return t <= nowMs;
  // Past appointments that were never cancelled count as visited.
  return t <= nowMs;
}

function hasUpcoming(appointments: RebookAppointment[], nowMs: number): boolean {
  return appointments.some((a) => {
    const status = String(a.status || "").toLowerCase();
    if (DEAD_STATUSES.has(status)) return false;
    const t = toTime(a.appointment_date);
    if (!Number.isFinite(t) || t <= nowMs) return false;
    return status === "" || UPCOMING_STATUSES.has(status);
  });
}

export function calculateAutoRebook(input: AutoRebookInput): AutoRebookDecision {
  const nowMs =
    input.now === undefined
      ? Date.now()
      : typeof input.now === "number"
        ? input.now
        : new Date(input.now).getTime();

  const base: AutoRebookDecision = {
    should_rebook: false,
    customer_id: input.customer_id,
    service_id: null,
    last_appointment_date: null,
    recommended_interval_days: AUTO_REBOOK_FALLBACK_DAYS,
    interval_source: "fallback",
    expected_return_date: null,
    days_overdue: 0,
    reason: "no_history",
    estimated_value: null,
  };

  const all = (input.appointments || []).filter((a) => a && a.appointment_date);

  if (hasUpcoming(all, nowMs)) {
    return { ...base, reason: "future_appointment" };
  }

  const past = all
    .filter((a) => isCompleted(a, nowMs))
    .sort((a, b) => toTime(a.appointment_date) - toTime(b.appointment_date));

  if (past.length === 0) return base;

  const last = past[past.length - 1];
  const lastMs = toTime(last.appointment_date);
  const serviceId = last.service_id || null;

  // ---- 1. service interval ----
  let interval: number | null = null;
  let source: IntervalSource = "fallback";
  const svcInterval = serviceId ? input.serviceIntervals?.[serviceId] : null;
  if (svcInterval != null && Number.isFinite(Number(svcInterval)) && Number(svcInterval) > 0) {
    interval = clampInterval(Number(svcInterval));
    source = "service";
  }

  // ---- 2. historical median (same service preferred, else all visits) ----
  if (interval == null) {
    const gapsFor = (rows: RebookAppointment[]): number[] => {
      const gaps: number[] = [];
      for (let i = 1; i < rows.length; i++) {
        const d = (toTime(rows[i].appointment_date) - toTime(rows[i - 1].appointment_date)) / DAY_MS;
        if (d >= 1 && d <= AUTO_REBOOK_MAX_DAYS * 2) gaps.push(d);
      }
      return gaps;
    };
    const sameService = serviceId ? past.filter((a) => a.service_id === serviceId) : [];
    const svcGaps = gapsFor(sameService);
    const allGaps = gapsFor(past);
    const chosen = svcGaps.length >= 2 ? svcGaps : allGaps.length >= 2 ? allGaps : null;
    if (chosen) {
      interval = clampInterval(median(chosen));
      source = "history";
    }
  }

  // ---- 3. fallback ----
  if (interval == null) {
    interval = AUTO_REBOOK_FALLBACK_DAYS;
    source = "fallback";
  }

  const expectedMs = startOfDay(lastMs) + interval * DAY_MS;
  const daysOverdue = Math.floor((startOfDay(nowMs) - expectedMs) / DAY_MS);

  const priceFromAppt = Number(last.price);
  const priceFromService = serviceId ? Number(input.servicePrices?.[serviceId]) : NaN;
  const estimated =
    Number.isFinite(priceFromAppt) && priceFromAppt > 0
      ? priceFromAppt
      : Number.isFinite(priceFromService) && priceFromService > 0
        ? priceFromService
        : null;

  const shouldRebook = daysOverdue >= 0;

  return {
    should_rebook: shouldRebook,
    customer_id: input.customer_id,
    service_id: serviceId,
    last_appointment_date: new Date(lastMs).toISOString(),
    recommended_interval_days: interval,
    interval_source: source,
    expected_return_date: ymd(expectedMs),
    days_overdue: daysOverdue,
    reason: shouldRebook ? `due_${source}` : "not_due_yet",
    estimated_value: estimated,
  };
}

export const AUTO_REBOOK_REASON_LABELS: Record<string, string> = {
  due_service: "Terugkomadvies van de behandeling bereikt",
  due_history: "Klant komt normaal nu terug",
  due_fallback: "Langer dan gebruikelijk niet geweest",
  not_due_yet: "Nog niet toe aan een nieuwe afspraak",
  future_appointment: "Heeft al een volgende afspraak",
  no_history: "Nog geen afgeronde afspraak",
};
