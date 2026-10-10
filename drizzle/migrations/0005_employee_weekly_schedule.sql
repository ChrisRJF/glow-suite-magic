CREATE OR REPLACE FUNCTION public.is_valid_weekly_schedule(_s jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT _s IS NULL OR (
    jsonb_typeof(_s) = 'object'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(_s) AS d(k, v)
      WHERE d.k !~ '^[1-7]$'
         OR jsonb_typeof(d.v) <> 'object'
         OR coalesce(d.v->>'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         OR coalesce(d.v->>'end', '')   !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         OR (d.v->>'start') >= (d.v->>'end')
    )
  )
$$;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS weekly_schedule jsonb DEFAULT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_weekly_schedule_valid') THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_weekly_schedule_valid
      CHECK (public.is_valid_weekly_schedule(weekly_schedule));
  END IF;
END $$;