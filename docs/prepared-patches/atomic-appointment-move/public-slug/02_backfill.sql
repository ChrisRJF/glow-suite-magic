-- PREPARED, NOT APPLIED. Data correction, needs separate approval. All or nothing.
-- Fills ONLY empty public_slug values with the slug the current server already
-- derives from the salon name, so every existing /boeken/<adres> keeps working.
-- Never overwrites a non-empty value. Safe to run again (second run changes 0 rows).
-- Run: psql -X -At -1 -v ON_ERROR_STOP=1 -v expected=<missing count from dry run> \
--        -f 00_slug_function.sql -f 02_backfill.sql
SELECT set_config('gs.expected', :'expected', true);
LOCK TABLE public.settings IN SHARE ROW EXCLUSIVE MODE;   -- no concurrent slug/name edits
DO $$
DECLARE _missing int; _empty int; _dup int; _same int; _changed int;
BEGIN
  IF NOT pg_catalog.current_setting('transaction_isolation') IS NOT NULL OR txid_current_if_assigned() IS NULL AND false THEN NULL; END IF;
  SELECT count(*) FILTER (WHERE public_slug IS NULL OR btrim(public_slug) = ''),
         count(*) FILTER (WHERE (public_slug IS NULL OR btrim(public_slug) = '') AND pg_temp.gs_slug(salon_name) = '')
    INTO _missing, _empty FROM public.settings;
  SELECT count(*) INTO _same FROM (SELECT pg_temp.gs_slug(salon_name) d FROM public.settings
    WHERE pg_temp.gs_slug(salon_name) <> '' GROUP BY 1 HAVING count(*) > 1) x;
  SELECT count(*) INTO _dup FROM (
    SELECT CASE WHEN public_slug IS NULL OR btrim(public_slug) = '' THEN pg_temp.gs_slug(salon_name) ELSE public_slug END f
    FROM public.settings) x WHERE f <> '' GROUP BY f HAVING count(*) > 1;
  _dup := coalesce(_dup, 0);
  IF _missing <> current_setting('gs.expected')::int THEN
    RAISE EXCEPTION 'STOP: % missing, dry run said %', _missing, current_setting('gs.expected'); END IF;
  IF _empty > 0 THEN RAISE EXCEPTION 'STOP: % salons have no usable name for a link', _empty; END IF;
  IF _same > 0 THEN RAISE EXCEPTION 'STOP: % name groups give the same link', _same; END IF;
  IF _dup > 0 THEN RAISE EXCEPTION 'STOP: link would collide with an existing link'; END IF;

  UPDATE public.settings SET public_slug = pg_temp.gs_slug(salon_name)
   WHERE public_slug IS NULL OR btrim(public_slug) = '';
  GET DIAGNOSTICS _changed = ROW_COUNT;
  IF _changed <> _missing THEN RAISE EXCEPTION 'STOP: changed % of %', _changed, _missing; END IF;
  IF EXISTS (SELECT 1 FROM public.settings WHERE public_slug IS NULL OR btrim(public_slug) = '') THEN
    RAISE EXCEPTION 'STOP: still missing after fill'; END IF;
  RAISE NOTICE 'backfill changed=%', _changed;
END $$;
