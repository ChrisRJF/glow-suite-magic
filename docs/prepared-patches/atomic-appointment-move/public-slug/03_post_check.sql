-- PREPARED. Read-only after-check. Counts only.
-- "address_ok": the address the current server accepts for this salon (its slugified
-- name) is found by the new lookup (stored public_slug) and points to THIS salon only.
BEGIN READ ONLY;
SELECT 'total='          || count(*)
  || ' missing='         || count(*) FILTER (WHERE s.public_slug IS NULL OR btrim(s.public_slug) = '')
  || ' address_ok='      || count(*) FILTER (WHERE (SELECT count(*) FROM public.settings o WHERE o.public_slug = pg_temp.gs_slug(s.salon_name)) = 1
                                              AND (SELECT o.id FROM public.settings o WHERE o.public_slug = pg_temp.gs_slug(s.salon_name) LIMIT 1) = s.id)
  || ' address_wrong='   || count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.settings o WHERE o.public_slug = pg_temp.gs_slug(s.salon_name) AND o.id <> s.id))
  || ' duplicates='      || (SELECT count(*) FROM (SELECT public_slug FROM public.settings WHERE public_slug IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d)
FROM public.settings s;
ROLLBACK;
