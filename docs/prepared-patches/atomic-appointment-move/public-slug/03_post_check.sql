-- PREPARED. Read-only after-check. Counts only. Run with -v live_user=<uuid> after 00.
-- plain_ok: the name-derived address (what the current server accepts) points to exactly one salon.
-- own_ok: every salon's stored link points to that salon only.
BEGIN READ ONLY;
SELECT 'total='     || count(*)
  || ' missing='    || count(*) FILTER (WHERE public_slug IS NULL OR btrim(public_slug) = '')
  || ' own_ok='     || count(*) FILTER (WHERE (SELECT count(*) FROM public.settings o WHERE o.public_slug = s.public_slug) = 1)
  || ' suffixed='   || count(*) FILTER (WHERE public_slug <> pg_temp.gs_slug(salon_name))
  || ' plain_ok='   || (SELECT count(DISTINCT pg_temp.gs_slug(salon_name)) FROM public.settings x
                        WHERE (SELECT count(*) FROM public.settings o WHERE o.public_slug = pg_temp.gs_slug(x.salon_name)) = 1)
  || ' live_plain=' || count(*) FILTER (WHERE user_id = :'live_user'::uuid AND public_slug = pg_temp.gs_slug(salon_name))
  || ' duplicates=' || (SELECT count(*) FROM (SELECT public_slug FROM public.settings WHERE public_slug IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d)
FROM public.settings s;
ROLLBACK;
