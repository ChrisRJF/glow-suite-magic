// Single source of truth for employee availability, shared with the public-booking server patch.
export * from "../../supabase/functions/_shared/inactive/employeeSchedule";
import { supabase } from "@/integrations/supabase/client";
import { callPublicBooking } from "@/lib/publicBooking";

let probe: Promise<boolean> | null = null;
/**
 * True only when BOTH the weekly_schedule column exists AND the online-booking server enforces it
 * (answers get_capabilities with availability_version 2). Otherwise the editor stays hidden, so
 * there is never a moment where hours are visible but not enforced.
 */
export function weeklyScheduleAvailable(): Promise<boolean> {
  if (!probe) {
    probe = (async () => {
      const { error } = await supabase.from("employees").select("weekly_schedule" as any).limit(0);
      if (error) return false;
      const caps = await callPublicBooking<{ availability_version?: number }>({ action: "get_capabilities" });
      return caps?.availability_version === 2;
    })().catch(() => false);
  }
  return probe;
}
