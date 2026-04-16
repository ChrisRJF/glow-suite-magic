import { useSettings } from "@/hooks/useSupabaseData";

/**
 * Single source of truth for demo mode.
 * Reads from settings.demo_mode in the database.
 */
export function useDemoMode() {
  const { data: settings, loading } = useSettings();
  const demoMode = settings.length > 0 ? Boolean((settings[0] as any).demo_mode) : false;
  return { demoMode, loading };
}
