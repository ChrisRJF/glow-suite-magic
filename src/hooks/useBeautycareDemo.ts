import { useSettings } from "@/hooks/useSupabaseData";

/**
 * Presentation-only gate for the Beautycare Groningen demo tenant.
 * Reads existing settings, writes nothing and changes no behaviour.
 */
export function useBeautycareDemo() {
  const { data, loading } = useSettings();
  const s = (data[0] as { demo_mode?: boolean; salon_name?: string } | undefined) ?? undefined;
  const active = Boolean(s?.demo_mode) && String(s?.salon_name ?? "").toLowerCase().includes("beautycare");
  return { active, loading };
}
