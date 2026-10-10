-- PREPARED, NOT APPLIED. Session-only helper (pg_temp): nothing persistent is created.
-- Same result as slugify() in supabase/functions/public-booking/index.ts:
--   lower -> NFKD -> strip U+0300..U+036F -> [^a-z0-9]+ to "-" -> trim "-".
-- NFKD and mark stripping run BEFORE lower so the result does not depend on the
-- database locale (lower() can then only change ASCII letters that matter).
CREATE OR REPLACE FUNCTION pg_temp.gs_slug(_t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(
    regexp_replace(
      lower(regexp_replace(normalize(coalesce(_t, ''), NFKD), '[\u0300-\u036f]', '', 'g')),
      '[^a-z0-9]+', '-', 'g'),
    '-')
$$;
