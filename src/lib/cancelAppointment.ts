import { supabase } from "@/integrations/supabase/client";

export type CancelSource = "salon_dashboard" | "salon_agenda" | "reception" | "system" | "api";

export interface CancelAppointmentResult {
  ok: boolean;
  alreadyCancelled?: boolean;
  notFound?: boolean;
  error?: string;
  side_effects?: {
    cancellation_count_incremented: boolean;
    sub_appointments_cancelled: number;
    automation_runs_cancelled: number;
    pending_payments_cancelled: number;
    admin_notified: boolean;
    audit_logged: boolean;
    waitlist_candidates: number;
  };
}

/**
 * Canonical client-side entry point for cancelling an appointment.
 * All salon-side UIs (dashboard, agenda, reception) MUST use this — never write
 * a status update to `appointments` directly.
 */
export async function cancelAppointment(
  appointmentId: string,
  source: CancelSource = "salon_agenda",
  reason?: string,
): Promise<CancelAppointmentResult> {
  const { data, error } = await supabase.functions.invoke("cancel-appointment", {
    body: { appointment_id: appointmentId, source, reason },
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: "no_response" }) as CancelAppointmentResult;
}
