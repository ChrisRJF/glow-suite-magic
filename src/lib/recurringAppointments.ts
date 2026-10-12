// Herhaalafspraken V1 (elke 2 weken). Uses ONLY agenda-create-appointment via buildCreateBody/createViaRoute.
// TEMPORARY allowlist for rollout (The Beautycare Clinic). Server re-checks login, salon, role, flag and conflicts.
import { buildCreateBody, createViaRoute, NON_DEFINITIVE_REFUSALS, type AgendaMode, type CreateBody, type CreateOutcome } from "@/lib/agendaCreateClient";

export const RECURRING_TENANTS: ReadonlySet<string> = new Set(["1c6c885e-c944-4717-b2ef-9cfdb9fa15ae", "cbd7d158-0133-4f2f-a504-4b82f73f2e20", "5dbfcbd4-48ff-4010-a1cc-07ed737880ce"]);
const ROLES = new Set(["eigenaar", "admin", "manager", "receptie"]);
export const RECURRING_COUNTS = [2, 4, 6, 8, 26] as const;
export const recurringCountLabel = (n: number) => (n === 26 ? "Heel jaar (26 afspraken)" : String(n));
export const RECURRING_NOTE = "Herhaalafspraak (elke 2 weken)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function recurringVisible(mode: AgendaMode, tenantId: unknown, roles: readonly string[] | null | undefined): boolean {
  return mode === "atomic" && typeof tenantId === "string" && RECURRING_TENANTS.has(tenantId) && (roles ?? []).some((r) => ROLES.has(r));
}

/** Calendar date (YYYY-MM-DD) in Europe/Amsterdam for an instant or plain date string. */
export function amsterdamDate(v: string | Date): string | null {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = typeof v === "string" ? new Date(v) : v;
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Next `count` biweekly calendar dates strictly after today (Amsterdam), never the source date itself. */
export function biweeklyDates(sourceDate: string, today: string, count: number): string[] {
  if (!RECURRING_COUNTS.includes(count as 2)) return [];
  let k = 1;
  while (addDays(sourceDate, 14 * k) <= today) k++;
  return Array.from({ length: count }, (_, i) => addDays(sourceDate, 14 * (k + i)));
}

export interface SourceAppointment {
  id: string; customer_id?: string | null; service_id?: string | null; start_time?: string | null; appointment_date?: string | null;
  booking_group_id?: string | null; journey_id?: string | null; employee_id?: string | null;
}

/** Validates the source; returns the template or a Dutch reason why it is blocked. */
export function recurringTemplate(a: SourceAppointment, links: { appointment_id: string; employee_id: string }[]):
  { ok: true; customer_id: string; service_id: string; time: string; date: string; employee_ids: string[] } | { ok: false; message: string } {
  if (a.booking_group_id || a.journey_id) return { ok: false, message: "Herhalen kan niet voor groepsboekingen of trajecten." };
  if (!a.customer_id || !UUID.test(a.customer_id) || !a.service_id || !UUID.test(a.service_id))
    return { ok: false, message: "Deze afspraak mist een klant of behandeling. Herhalen is niet mogelijk." };
  const time = (a.start_time ?? "").slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, message: "De starttijd van deze afspraak is niet betrouwbaar. Herhalen is niet mogelijk." };
  const date = a.appointment_date ? amsterdamDate(a.appointment_date) : null;
  if (!date) return { ok: false, message: "De datum van deze afspraak is niet betrouwbaar. Herhalen is niet mogelijk." };
  const ids = [...new Set(links.filter((l) => l.appointment_id === a.id).map((l) => l.employee_id))];
  if (ids.some((e) => !UUID.test(e)) || ids.length > 5) return { ok: false, message: "De medewerkerkoppeling is niet duidelijk. Herhalen is niet mogelijk." };
  if (a.employee_id && !ids.includes(a.employee_id)) return { ok: false, message: "De medewerkerkoppeling is niet duidelijk. Herhalen is niet mogelijk." };
  return { ok: true, customer_id: a.customer_id, service_id: a.service_id, time, date, employee_ids: ids };
}

export type ItemStatus = "pending" | "created" | "unknown" | "refused";
export interface BatchItem { date: string; body: CreateBody; status: ItemStatus; message?: string }
export interface Batch { v: 1; sourceId: string; items: BatchItem[] }

export function batchKey(userId: string, tenantId: string, sourceId: string) { return `glowsuite.recurring.v1:${userId}:${tenantId}:${sourceId}`; }

/** `times[i]` optionally overrides the start time for `dates[i]`; default is the source time. */
export function buildBatch(sourceId: string, t: { customer_id: string; service_id: string; time: string; employee_ids: string[] }, dates: string[], newId: () => string, times?: readonly (string | undefined)[]):
  { ok: true; batch: Batch } | { ok: false; message: string } {
  const items: BatchItem[] = [];
  for (const [i, date] of dates.entries()) {
    const time = times?.[i] || t.time;
    const b = buildCreateBody(newId(), { customer_id: t.customer_id, service_id: t.service_id, date, time, employee_ids: t.employee_ids, notes: RECURRING_NOTE, group: [], send_confirmation: false }, { uiEnabled: false });
    if (b.ok === false) return { ok: false, message: b.message };
    items.push({ date, body: { ...b.body, send_confirmation: false }, status: "pending" });
  }
  return { ok: true, batch: { v: 1, sourceId, items } };
}

export interface Store { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void }

export function saveBatch(store: Store, key: string, batch: Batch): boolean {
  try { store.set(key, JSON.stringify(batch)); return store.get(key) === JSON.stringify(batch); } catch { return false; }
}
export function loadBatch(store: Store, key: string): Batch | null {
  try { const raw = store.get(key); if (!raw) return null; const b = JSON.parse(raw); return b?.v === 1 && Array.isArray(b.items) ? b : null; } catch { return null; }
}

export type RunResult = { kind: "done" } | { kind: "unknown"; date: string } | { kind: "stopped"; date: string; message: string; final: boolean } | { kind: "storage" };

/** Sequential, stops at the first non-success. Every item's id/body is fixed in storage before any send. */
export async function runBatch(store: Store, key: string, batch: Batch, create: (b: CreateBody) => Promise<CreateOutcome>, onChange?: (b: Batch) => void): Promise<RunResult> {
  if (!saveBatch(store, key, batch)) return { kind: "storage" };
  for (const item of batch.items) {
    if (item.status === "created") continue;
    if (item.status === "refused") return { kind: "stopped", date: item.date, message: item.message ?? "", final: true };
    const out = await create({ ...item.body, send_confirmation: false });
    if (out.kind === "created") item.status = "created";
    else if (out.kind === "unknown") { item.status = "unknown"; item.message = out.message; }
    else if (NON_DEFINITIVE_REFUSALS.has(out.code)) { item.status = "unknown"; item.message = out.message; }
    else { item.status = "refused"; item.message = out.message; }
    saveBatch(store, key, batch); onChange?.({ ...batch, items: [...batch.items] });
    if (item.status === "unknown") return out.kind === "refused" ? { kind: "stopped", date: item.date, message: out.message, final: false } : { kind: "unknown", date: item.date };
    if (item.status === "refused") return { kind: "stopped", date: item.date, message: item.message!, final: true };
  }
  return { kind: "done" };
}

export function routeCreate(invoke: Parameters<typeof createViaRoute>[0]) { return (b: CreateBody) => createViaRoute(invoke, b); }
