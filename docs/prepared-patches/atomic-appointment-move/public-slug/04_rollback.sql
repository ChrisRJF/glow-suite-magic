-- PREPARED, emergency only, separate approval. Empties the links this backfill wrote.
-- Only valid while no salon had a link before (count before: 0 of 9). Refuses if any stored
-- link is not one this backfill could have written (plain or "<plain>-<own id prefix>").
-- Run: psql -X -At -1 -v ON_ERROR_STOP=1 -v expected=<rows filled> -f 00_slug_function.sql -f 04_rollback.sql
SELECT set_config('gs.expected', :'expected', true);
LOCK TABLE public.settings IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE _n int; _other int; _changed int;
BEGIN
  CREATE TEMP TABLE gs_ours ON COMMIT DROP AS
  SELECT id, public_slug IN (pg_temp.gs_slug(salon_name), pg_temp.gs_slug(salon_name) || '-' || left(replace(id::text, '-', ''), 6)) AS ours
  FROM public.settings WHERE public_slug IS NOT NULL;
  SELECT count(*) FILTER (WHERE ours), count(*) FILTER (WHERE NOT ours) INTO _n, _other FROM gs_ours;
  IF _other > 0 THEN RAISE EXCEPTION 'STOP: % links were changed after the backfill', _other; END IF;
  IF _n <> current_setting('gs.expected')::int THEN RAISE EXCEPTION 'STOP: % links, expected %', _n, current_setting('gs.expected'); END IF;
  UPDATE public.settings p SET public_slug = NULL FROM gs_ours o WHERE p.id = o.id AND o.ours;
  GET DIAGNOSTICS _changed = ROW_COUNT;
  RAISE NOTICE 'rollback changed=%', _changed;
END $$;
