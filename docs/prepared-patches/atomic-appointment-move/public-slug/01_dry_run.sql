-- PREPARED, NOT APPLIED. Read-only dry run. Prints counts only, never names or links.
-- Run: psql -X -At -v ON_ERROR_STOP=1 -f 00_slug_function.sql -f 01_dry_run.sql
BEGIN READ ONLY;
WITH s AS (
  SELECT id, (public_slug IS NULL OR btrim(public_slug) = '') AS missing,
         public_slug, pg_temp.gs_slug(salon_name) AS derived
  FROM public.settings
), target AS (           -- the value each row will have after the backfill
  SELECT id, missing, derived, public_slug, CASE WHEN missing THEN derived ELSE public_slug END AS final_slug FROM s
)
SELECT 'total='              || count(*)
  || ' missing='             || count(*) FILTER (WHERE missing)
  || ' already_set='         || count(*) FILTER (WHERE NOT missing)
  || ' empty_derived='       || count(*) FILTER (WHERE missing AND derived = '')
  || ' duplicate_after='     || (SELECT count(*) FROM (SELECT final_slug FROM target WHERE final_slug <> '' GROUP BY 1 HAVING count(*) > 1) d)
  || ' same_name_salons='    || (SELECT count(*) FROM (SELECT derived FROM s WHERE derived <> '' GROUP BY 1 HAVING count(*) > 1) d)
  || ' set_differs_from_name=' || count(*) FILTER (WHERE NOT missing AND public_slug <> derived)
  || ' verdict='             || CASE WHEN count(*) FILTER (WHERE missing AND derived = '') = 0
                                 AND (SELECT count(*) FROM (SELECT final_slug FROM target WHERE final_slug <> '' GROUP BY 1 HAVING count(*) > 1) d) = 0
                                 AND (SELECT count(*) FROM (SELECT derived FROM s WHERE derived <> '' GROUP BY 1 HAVING count(*) > 1) d) = 0
                               THEN 'OK' ELSE 'STOP' END
FROM target;
ROLLBACK;
