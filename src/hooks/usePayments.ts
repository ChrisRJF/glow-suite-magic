import { useSupabaseQuery } from "@/hooks/useSupabaseData";

export function usePayments() {
  return useSupabaseQuery("payments");
}
