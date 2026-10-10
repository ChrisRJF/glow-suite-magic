-- PROPOSED, NOT APPLIED. Requires separate approval.
-- Adds a recurring weekly schedule per employee. NULL = keep current behaviour
-- (working_days + salon opening hours), so existing salons and appointments are untouched.
-- Shape: {"1":{"start":"09:00","end":"16:00"},"2":{"start":"09:00","end":"14:00"}, ...}
-- Keys are ISO weekdays 1=maandag .. 7=zondag. Missing key = not working that day.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS weekly_schedule jsonb DEFAULT NULL;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_weekly_schedule_is_object
  CHECK (weekly_schedule IS NULL OR jsonb_typeof(weekly_schedule) = 'object');
