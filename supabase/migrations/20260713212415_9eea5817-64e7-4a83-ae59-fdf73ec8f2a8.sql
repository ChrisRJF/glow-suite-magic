-- Trigger: invalidate stale reminders when an appointment is rescheduled.
CREATE OR REPLACE FUNCTION public.invalidate_reminders_on_reschedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act on real time changes (date or start_time). Ignore status-only edits.
  IF (NEW.appointment_date IS DISTINCT FROM OLD.appointment_date)
     OR (NEW.start_time IS DISTINCT FROM OLD.start_time) THEN

    -- 1. Release the canonical "reminder" claim so the scheduler can create a new one.
    DELETE FROM public.reminder_dispatch_claims
    WHERE appointment_id = NEW.id
      AND reminder_type = 'reminder';

    -- 2. Rename existing sent/demo reminder logs so reminderAlreadySent() no
    --    longer matches them. Audit history stays intact.
    UPDATE public.whatsapp_logs
    SET reminder_type = 'reminder_stale',
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'invalidated_reason', 'appointment_rescheduled',
          'invalidated_at', now()
        )
    WHERE appointment_id = NEW.id
      AND reminder_type = 'reminder'
      AND status IN ('sent', 'demo');

    -- 3. Stop any pending WhatsApp reminder retries — do NOT mark them as
    --    failed (which would count as a delivery failure); mark them stale.
    UPDATE public.whatsapp_logs
    SET dead_letter = true,
        next_retry_at = NULL,
        status = 'stale',
        error = 'appointment_rescheduled',
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'invalidated_reason', 'appointment_rescheduled',
          'invalidated_at', now()
        )
    WHERE appointment_id = NEW.id
      AND reminder_type IN ('reminder', 'reminder_stale')
      AND status = 'failed'
      AND dead_letter = false
      AND next_retry_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_reminders_on_reschedule ON public.appointments;
CREATE TRIGGER trg_invalidate_reminders_on_reschedule
AFTER UPDATE OF appointment_date, start_time ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_reminders_on_reschedule();