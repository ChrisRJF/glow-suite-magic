-- PREPARED, NOT APPLIED. Data correction, needs separate approval. All or nothing.
-- Fills ONLY empty public_slug values. Per derived link: the live salon keeps the plain link,
-- otherwise the oldest (created_at, id). Others get "<link>-<first 6 hex of settings.id>".
-- Never overwrites a non-empty value. A second run changes 0 rows.
-- Run: psql -X -At -1 -v ON_ERROR_STOP=1 -v expected=<missing> -v live_user=<uuid> \
--        -f 00_slug_function.sql -f 02_backfill.sql
SELECT set_config('gs.expected', :'expected', true), set_config('gs.live', :'live_user', true);
LOCK TABLE public.settings IN SHARE ROW EXCLUSIVE MODE;   -- no concurrent slug/name edits
DO $$
DECLARE _live uuid := current_setting('gs.live')::uuid; _missing int; _empty int; _dup int; _live_rows int; _live_plain int; _changed int;
BEGIN
  CREATE TEMP TABLE gs_target ON COMMIT DROP AS
  WITH s AS (SELECT id, user_id, created_at, public_slug, (public_slug IS NULL OR btrim(public_slug) = '') AS missing,
                    pg_temp.gs_slug(salon_name) AS derived FROM public.settings),
       r AS (SELECT id, row_number() OVER (PARTITION BY derived ORDER BY (user_id = _live) DESC, created_at, id) AS rn
             FROM s WHERE missing AND derived <> '')
  SELECT s.id, s.user_id, s.missing, s.derived,
         CASE WHEN NOT s.missing THEN s.public_slug WHEN r.rn = 1 THEN s.derived
              WHEN r.rn > 1 THEN s.derived || '-' || left(replace(s.id::text, '-', ''), 6) END AS final_slug
  FROM s LEFT JOIN r USING (id);

  SELECT count(*) FILTER (WHERE missing), count(*) FILTER (WHERE missing AND derived = ''),
         count(*) FILTER (WHERE user_id = _live), count(*) FILTER (WHERE user_id = _live AND final_slug = derived)
    INTO _missing, _empty, _live_rows, _live_plain FROM gs_target;
  SELECT count(*) INTO _dup FROM (SELECT final_slug FROM gs_target WHERE final_slug <> '' GROUP BY 1 HAVING count(*) > 1) x;
  IF _missing <> current_setting('gs.expected')::int THEN
    RAISE EXCEPTION 'STOP: % missing, dry run said %', _missing, current_setting('gs.expected'); END IF;
  IF _empty > 0 THEN RAISE EXCEPTION 'STOP: % salons have no usable name for a link', _empty; END IF;
  IF _live_rows <> 1 OR _live_plain <> 1 THEN RAISE EXCEPTION 'STOP: live salon not found once or would not keep its plain link'; END IF;
  IF _dup > 0 THEN RAISE EXCEPTION 'STOP: link would collide'; END IF;

  UPDATE public.settings p SET public_slug = t.final_slug FROM gs_target t
   WHERE p.id = t.id AND t.missing AND (p.public_slug IS NULL OR btrim(p.public_slug) = '');
  GET DIAGNOSTICS _changed = ROW_COUNT;
  IF _changed <> _missing THEN RAISE EXCEPTION 'STOP: changed % of %', _changed, _missing; END IF;
  IF EXISTS (SELECT 1 FROM public.settings WHERE public_slug IS NULL OR btrim(public_slug) = '') THEN
    RAISE EXCEPTION 'STOP: still missing after fill'; END IF;
  RAISE NOTICE 'backfill changed=%', _changed;
END $$;
