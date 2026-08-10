/**
 * Single frontend source of truth for "which customers are ready to come back".
 *
 * Every assistant card, opportunity list and the Auto Rebook hub itself must
 * use this helper. No component may keep its own day-count thresholds.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { calculateAutoRebook, type AutoRebookDecision } from "@/lib/autoRebook";

export interface DueRebookCustomer {
  customer_id: string;
  decision: AutoRebookDecision;
}

interface ServiceLike {
  id: string;
  price?: number | null;
  rebook_interval_days?: number | null;
}

/**
 * Server-narrowed candidates (tenant + demo scoped, not limited to whatever
 * the browser happens to have loaded), decided by the canonical engine.
 */
export async function fetchDueRebookCustomers(
  services: ServiceLike[] | null | undefined,
): Promise<DueRebookCustomer[]> {
  const { data, error } = await supabase.rpc("auto_rebook_candidates", { _max_customers: 2000 });
  if (error || !data) return [];

  const serviceIntervals: Record<string, number | null> = {};
  const servicePrices: Record<string, number | null> = {};
  for (const s of services || []) {
    serviceIntervals[s.id] = s.rebook_interval_days ?? null;
    servicePrices[s.id] = Number(s.price ?? 0) || null;
  }

  const out: DueRebookCustomer[] = [];
  for (const row of data as Array<{ customer_id: string; appointments: unknown }>) {
    const decision = calculateAutoRebook({
      customer_id: row.customer_id,
      appointments: (row.appointments as any[]) || [],
      serviceIntervals,
      servicePrices,
    });
    if (decision.should_rebook) out.push({ customer_id: row.customer_id, decision });
  }
  return out;
}

/** Month start expressed in the salon timezone, not the browser timezone. */
export function salonMonthStartIso(timezone?: string | null): string {
  const tz = timezone || "Europe/Amsterdam";
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "01";
  return new Date(`${get("year")}-${get("month")}-01T00:00:00Z`).toISOString();
}

/** React hook: canonical due-for-rebook list, shared by every assistant surface. */
export function useDueRebook(services: ServiceLike[] | null | undefined) {
  const [rows, setRows] = useState<DueRebookCustomer[]>([]);
  useEffect(() => {
    let active = true;
    fetchDueRebookCustomers(services).then((r) => { if (active) setRows(r); });
    return () => { active = false; };
  }, [services]);
  const estimatedValue = useMemo(
    () => rows.reduce((sum, r) => sum + Number(r.decision.estimated_value || 0), 0),
    [rows],
  );
  return { dueRows: rows, dueCount: rows.length, estimatedValue };
}
