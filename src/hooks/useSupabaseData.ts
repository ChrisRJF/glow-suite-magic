import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

type TableName = keyof import("@/integrations/supabase/types").Database["public"]["Tables"];
type AnyTableName = TableName | "membership_plans" | "customer_memberships" | "membership_usage";

export function useSupabaseQuery<T extends AnyTableName>(
  table: T,
  options?: { orderBy?: string; ascending?: boolean; enabled?: boolean }
) {
  const { user } = useAuth();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) { setData([]); setLoading(false); return; }
    setLoading(true);
    let query = (supabase as any).from(table).select("*");
    if (options?.orderBy) {
      query = query.order(options.orderBy, { ascending: options.ascending ?? false });
    } else {
      query = query.order("created_at", { ascending: false });
    }
    const { data: result, error } = await query;
    if (!error && result) setData(result);
    setLoading(false);
  }, [user, table, options?.orderBy, options?.ascending]);

  useEffect(() => {
    if (options?.enabled === false) return;
    fetch();
  }, [fetch, options?.enabled]);

  return { data, loading, refetch: fetch };
}

export function useCustomers() {
  return useSupabaseQuery("customers", { orderBy: "name", ascending: true });
}

export function useServices() {
  return useSupabaseQuery("services", { orderBy: "name", ascending: true });
}

export function useProducts() {
  return useSupabaseQuery("products", { orderBy: "name", ascending: true });
}

export function useAppointments() {
  return useSupabaseQuery("appointments", { orderBy: "appointment_date", ascending: true });
}

export function useCampaigns() {
  return useSupabaseQuery("campaigns");
}

export function useDiscounts() {
  return useSupabaseQuery("discounts");
}

export function useFeedback() {
  return useSupabaseQuery("feedback_entries");
}

export function useRebookActions() {
  return useSupabaseQuery("rebook_actions");
}

export function useSettings() {
  return useSupabaseQuery("settings");
}

export function useCheckoutItems() {
  return useSupabaseQuery("checkout_items");
}

export function useWaitlist() {
  return useSupabaseQuery("waitlist_entries");
}

export function useGiftCards() {
  return useSupabaseQuery("gift_cards");
}

export function usePaymentLinks() {
  return useSupabaseQuery("payment_links");
}

export function useLeads() {
  return useSupabaseQuery("leads");
}

export function useEmployees() {
  return useSupabaseQuery("employees", { orderBy: "sort_order", ascending: true });
}

export function useAppointmentEmployees() {
  return useSupabaseQuery("appointment_employees", { orderBy: "created_at", ascending: true });
}

export function useEmployeeAvailabilityExceptions() {
  return useSupabaseQuery("employee_availability_exceptions" as any, { orderBy: "start_date", ascending: true });
}

export function useMollieConnections() {
  return useSupabaseQuery("mollie_connections");
}

export function usePaymentRefunds() {
  return useSupabaseQuery("payment_refunds");
}

export function useMembershipPlans() {
  return useSupabaseQuery("membership_plans", { orderBy: "name", ascending: true });
}

export function useCustomerMemberships() {
  return useSupabaseQuery("customer_memberships");
}

export function useMembershipUsage() {
  return useSupabaseQuery("membership_usage");
}

export function useWebshopOrders() {
  const { user } = useAuth();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) { setData([]); setLoading(false); return; }
    setLoading(true);
    const { data: result } = await (supabase as any)
      .from("webshop_orders")
      .select("*")
      .order("created_at", { ascending: false });
    setData(result || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);
  return { data, loading, refetch: fetch };
}
