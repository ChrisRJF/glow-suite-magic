# public_slug backfill (PREPARED, NOT APPLIED)

Why: the current server finds a salon by `slugify(salon_name)` when `public_slug` is empty.
The atomic server requires a stored `public_slug`. Filling it with exactly that value keeps
every existing `/boeken/<address>` working on both the old and new server.

Order (each step needs approval; counts only, never names or links):
1. `00` + `01_dry_run.sql` (read-only). Continue only on `verdict=OK`.
2. `00` + `02_backfill.sql` with `-1 -v expected=<missing>`. All or nothing; stops on drift,
   empty names, same-name salons or collisions. A second run changes 0 rows.
3. `00` + `03_post_check.sql`: expect `missing=0 address_wrong=0 duplicates=0`.
4. Emergency only: `04_rollback.sql` (refuses if a salon changed its link afterwards).

Side effects of a filled link (live code that already reads `public_slug`):
- send-white-label-email: the sender address becomes `<slug>@...` instead of `<slug><8 chars>@...`.
- auto-rebook-send: rebook links go to `/boeken/<slug>?rb=...` instead of `/boeken?rb=...`.
- public-shop / public-memberships: those pages can now find the salon (today they cannot).

Test: `bash tests/atomic-appointment-move/run-slug-backfill.sh` (throwaway PostgreSQL, fictional salons).
