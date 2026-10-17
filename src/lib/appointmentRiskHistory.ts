import type { NoShowRiskInput } from "./noShowRisk";

export interface RiskAppointment {
  id: string;
  user_id: string;
  customer_id: string | null;
  status: string;
}
const completed = new Set(["voltooid", "completed", "afgerond", "done"]);
const noShows = new Set(["no-show", "no_show", "noshow", "niet_verschenen"]);

/** Caller must supply a successful complete, authorized database read.
 * No client-provided history, counters, dates or audit guesses are accepted.
 */
export function appointmentRiskHistory(
  rows: readonly RiskAppointment[], tenantId: string, customerId: string,
  complete: boolean,
): NoShowRiskInput["verifiedHistory"] {
  if (!complete || !tenantId || !customerId) return undefined;
  const seen = new Set<string>();
  const history = { completed: 0, noShows: 0, lateCancellations: 0 };
  for (const row of rows) {
    if (!row.id || seen.has(row.id) || row.user_id !== tenantId
      || row.customer_id !== customerId || typeof row.status !== "string") return undefined;
    seen.add(row.id);
    // Current explicit outcomes only. Cancellation timing is NOT inferred.
    if (completed.has(row.status)) history.completed++;
    else if (noShows.has(row.status)) history.noShows++;
  }
  return history;
}

interface HistoryPage {
  data: RiskAppointment[] | null;
  error: unknown;
  count: number | null;
}
export type ReadHistoryPage = (scope: {
  tenantId: string; customerId: string; from: number; to: number;
}) => PromiseLike<HistoryPage>;

/** Read-only paged loader; tenant/customer must be server-derived for deposits.
 * Frontend uses its authenticated RLS client, never a service-role client.
 */
export async function loadAppointmentRiskHistory(
  readPage: ReadHistoryPage, tenantId: string, customerId: string,
): Promise<NoShowRiskInput["verifiedHistory"]> {
  if (!tenantId || !customerId) return undefined;
  const rows: RiskAppointment[] = [];
  let expected: number | undefined;
  try {
    for (let from = 0; from < 100_000; from += 1000) {
      const page = await readPage({ tenantId, customerId, from, to: from + 999 });
      if (page.error || !page.data || !Number.isSafeInteger(page.count)
        || page.count == null || page.count < 0) return undefined;
      if (expected === undefined) expected = page.count;
      if (page.count !== expected || page.data.length > 1000) return undefined;
      rows.push(...page.data);
      if (rows.length > expected) return undefined;
      if (rows.length === expected) return appointmentRiskHistory(rows, tenantId, customerId, true);
      if (page.data.length < 1000) return undefined;
    }
  } catch { return undefined; }
  return undefined;
}
