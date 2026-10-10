// Single source of truth for employee availability, shared with the public-booking server patch.
export * from "../../supabase/functions/_shared/inactive/employeeSchedule";
import { supabase } from "@/integrations/supabase/client";

let probe: Promise<boolean> | null = null;
/**
 * True only once the weekly_schedule column exists in the database. Until the migration is
 * applied the schedule editor stays hidden and nothing writes the column.
 */
export function weeklyScheduleAvailable(): Promise<boolean> {
  if (!probe) {
    probe = (async () => {
      const { error } = await supabase.from("employees").select("weekly_schedule" as any).limit(0);
      return !error;
    })().catch(() => false);
  }
  return probe;
}
