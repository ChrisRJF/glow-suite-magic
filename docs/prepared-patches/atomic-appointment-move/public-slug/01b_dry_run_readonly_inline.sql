-- PREPARED. Fully read-only dry run: creates NO objects. Prints counts only.
-- Rule: per derived link, the live salon (-v live_user) keeps the plain link; otherwise the
-- oldest (created_at, id) keeps it. Others get "<link>-<first 6 hex of settings.id>".
-- Run: psql -X -At -v ON_ERROR_STOP=1 -v live_user=<uuid> -f 01b_dry_run_readonly_inline.sql
BEGIN TRANSACTION READ ONLY;
WITH s AS (
  SELECT id, user_id, is_demo, public_slug, (public_slug IS NULL OR btrim(public_slug) = '') AS missing,
         btrim(regexp_replace(lower(regexp_replace(normalize(coalesce(salon_name, ''), NFKD), '[\u0300-\u036f]', '', 'g')), '[^a-z0-9]+', '-', 'g'), '-') AS derived
  FROM public.settings
), r AS (
  SELECT s.*, row_number() OVER (PARTITION BY derived ORDER BY (user_id = :'live_user'::uuid) DESC, created_at, id) AS rn
  FROM s JOIN public.settings USING (id) WHERE missing AND derived <> ''
), target AS (
  SELECT s.id, s.missing, s.derived, s.user_id,
         CASE WHEN NOT s.missing THEN s.public_slug WHEN r.rn = 1 THEN s.derived
              WHEN r.rn > 1 THEN s.derived || '-' || left(replace(s.id::text, '-', ''), 6) END AS final_slug
  FROM s LEFT JOIN r USING (id)
), agg AS (
  SELECT count(*) AS total, count(*) FILTER (WHERE missing) AS missing,
         count(*) FILTER (WHERE missing AND derived = '') AS empty_derived,
         (SELECT count(*) FROM (SELECT derived FROM r GROUP BY 1 HAVING count(*) > 1) g) AS conflict_groups,
         (SELECT count(*) FROM r WHERE rn > 1) AS suffixed,
         (SELECT count(*) FROM (SELECT final_slug FROM target WHERE final_slug <> '' GROUP BY 1 HAVING count(*) > 1) d) AS duplicate_after,
         count(*) FILTER (WHERE user_id = :'live_user'::uuid) AS live_rows,
         count(*) FILTER (WHERE user_id = :'live_user'::uuid AND final_slug = derived) AS live_plain,
         count(*) FILTER (WHERE missing AND final_slug IS NOT NULL) AS would_update
  FROM target
)
SELECT 'total=' || total || ' missing=' || missing || ' empty_derived=' || empty_derived
  || ' conflict_groups=' || conflict_groups || ' suffixed=' || suffixed || ' duplicate_after=' || duplicate_after
  || ' live_rows=' || live_rows || ' live_plain=' || live_plain || ' would_update=' || would_update
  || ' verdict=' || CASE WHEN empty_derived = 0 AND duplicate_after = 0 AND live_rows = 1 AND live_plain = 1 THEN 'OK' ELSE 'STOP' END
FROM agg;
ROLLBACK;
