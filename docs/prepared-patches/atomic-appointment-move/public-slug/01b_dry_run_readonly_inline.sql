-- PREPARED, NOT APPLIED. Fully read-only dry run: creates NO objects (not even pg_temp).
-- Inline equivalent of 00_slug_function.sql gs_slug(). Prints counts only.
-- Run alone: psql -X -At -v ON_ERROR_STOP=1 -f 01b_dry_run_readonly_inline.sql
BEGIN TRANSACTION READ ONLY;
WITH s AS (
  SELECT id, (public_slug IS NULL OR btrim(public_slug) = '') AS missing, public_slug,
         btrim(regexp_replace(lower(regexp_replace(normalize(coalesce(salon_name, ''), NFKD), '[\u0300-\u036f]', '', 'g')), '[^a-z0-9]+', '-', 'g'), '-') AS derived
  FROM public.settings
), target AS (
  SELECT missing, derived, public_slug, CASE WHEN missing THEN derived ELSE public_slug END AS final_slug FROM s
), agg AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE missing) AS missing,
         count(*) FILTER (WHERE missing AND derived = '') AS empty_derived,
         count(*) FILTER (WHERE missing AND derived <> '') AS would_update,
         (SELECT count(*) FROM (SELECT final_slug FROM target WHERE final_slug <> '' GROUP BY 1 HAVING count(*) > 1) d) AS duplicate_after,
         (SELECT count(*) FROM (SELECT derived FROM s WHERE derived <> '' GROUP BY 1 HAVING count(*) > 1) d) AS same_name_salons
  FROM target
)
SELECT 'total=' || total || ' missing=' || missing || ' empty_derived=' || empty_derived
  || ' duplicate_after=' || duplicate_after || ' same_name_salons=' || same_name_salons
  || ' would_update=' || would_update
  || ' verdict=' || CASE WHEN empty_derived = 0 AND duplicate_after = 0 AND same_name_salons = 0 THEN 'OK' ELSE 'STOP' END
FROM agg;
ROLLBACK;
