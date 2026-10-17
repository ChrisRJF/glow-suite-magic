import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadAppointmentRiskHistory } from "./appointmentRiskHistory";
import type { NoShowRiskInput } from "./noShowRisk";

type Customer = { id: string; user_id: string };
/** RLS-only presentation evidence. Server deposits always reload independently. */
export function useCustomerRiskHistory<T extends Customer>(customers: T[]) {
  const [state, setState] = useState<{ source: T[]; data: Array<T & NoShowRiskInput> }>();
  useEffect(() => {
    let stale = false;
    async function load() {
      const data: Array<T & NoShowRiskInput> = [];
      // Serial reads avoid an unbounded per-customer request burst.
      for (const customer of customers) {
        if (stale) return;
        const verifiedHistory = await loadAppointmentRiskHistory(
          ({ tenantId, customerId, from, to }) => supabase.from("appointments")
            .select("id,user_id,customer_id,status", { count: "exact" })
            .eq("user_id", tenantId).eq("customer_id", customerId)
            .order("id", { ascending: true }).range(from, to),
          customer.user_id, customer.id,
        );
        data.push({ ...customer, verifiedHistory });
      }
      if (!stale) setState({ source: customers, data });
    }
    void load();
    return () => { stale = true; };
  }, [customers]);
  // Never reuse history after account/data change or while a fresh read is pending.
  return state?.source === customers ? state.data
    : customers.map(customer => ({ ...customer, verifiedHistory: undefined }));
}