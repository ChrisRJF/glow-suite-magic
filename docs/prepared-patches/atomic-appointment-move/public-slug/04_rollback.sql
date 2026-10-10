-- PREPARED, emergency only, separate approval. Empties the links this backfill wrote.
-- Only valid while no salon had a link before (current count: 0 of 9). Refuses if any
-- stored link differs from the name-derived one (a salon may have chosen it later).
-- Run: psql -X -At -1 -v ON_ERROR_STOP=1 -v expected=<rows filled> -f 00_slug_function.sql -f 04_rollback.sql
SELECT set_config('gs.expected', :'expected', true);
LOCK TABLE public.settings IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE _n int; _other int; _changed int;
BEGIN
  SELECT count(*) FILTER (WHERE public_slug = pg_temp.gs_slug(salon_name)),
         count(*) FILTER (WHERE public_slug IS NOT NULL AND public_slug <> pg_temp.gs_slug(salon_name))
    INTO _n, _other FROM public.settings;
  IF _other > 0 THEN RAISE EXCEPTION 'STOP: % links were changed after the backfill', _other; END IF;
  IF _n <> current_setting('gs.expected')::int THEN RAISE EXCEPTION 'STOP: % links, expected %', _n, current_setting('gs.expected'); END IF;
  UPDATE public.settings SET public_slug = NULL WHERE public_slug = pg_temp.gs_slug(salon_name);
  GET DIAGNOSTICS _changed = ROW_COUNT;
  RAISE NOTICE 'rollback changed=%', _changed;
END $$;
