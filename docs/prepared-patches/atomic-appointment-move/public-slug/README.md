# public_slug backfill (PREPARED, NOT APPLIED)

Why: the current server finds a salon by `slugify(salon_name)` when `public_slug` is empty.
The atomic server requires a stored `public_slug`. Filling it with exactly that value keeps
every existing `/boeken/<address>` working on both the old and new server.

Order (each step needs approval; counts only, never names or links):
Same-name rule: per derived link the live salon (`-v live_user=<uuid>`) keeps the plain link,
otherwise the oldest salon (created_at, then id). The others get `<link>-<first 6 hex of settings.id>`.

1. `01b_dry_run_readonly_inline.sql -v live_user=<uuid>` (read-only, creates nothing). Continue only on `verdict=OK`.
2. `00` + `02_backfill.sql` with `-1 -v expected=<missing> -v live_user=<uuid>`. All or nothing; stops on drift,
   empty names, live salon not found once, or any collision. A second run changes 0 rows.
3. `00` + `03_post_check.sql -v live_user=<uuid>`: expect `missing=0 duplicates=0 live_plain=1`.
4. Emergency only: `04_rollback.sql` (refuses if a salon changed its link afterwards).

Side effects of a filled link (live code that already reads `public_slug`):
- send-white-label-email: the sender address becomes `<slug>@...` instead of `<slug><8 chars>@...`.
- auto-rebook-send: rebook links go to `/boeken/<slug>?rb=...` instead of `/boeken?rb=...`.
- public-shop / public-memberships: those pages can now find the salon (today they cannot).

New salons: before onboarding (saveSalon) creates or names a salon, it must set public_slug to the
derived link and, on a unique-index conflict, retry with the same `-<6 hex id>` suffix. Not built yet;
separate approval.

Test: `bash tests/atomic-appointment-move/run-slug-backfill.sh` and `run-slug-dryrun-inline.sh` (throwaway PostgreSQL, fictional salons).
