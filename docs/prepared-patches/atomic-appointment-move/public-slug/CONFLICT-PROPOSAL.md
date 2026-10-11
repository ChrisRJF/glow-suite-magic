# public_slug conflicts: proposal (offline, not applied)

Production read-only findings (counts only):
- Group 1: 5 accounts, 5 different users, 0 Beautycare, all is_demo=false. Live/test cannot be reliably classified from data.
- Group 2: 2 accounts, 2 different users: the Beautycare live row (identified by its known tenant id, is_demo=false) and 1 row with is_demo=true.

Current server risk: with an empty public_slug, public-booking loads up to 200 settings rows without ordering
and takes the first row whose slugified name matches. For both groups the result is not deterministic, so the
Beautycare address can already resolve to the other (demo) account.

Minimal fix (requires separate approval, change 02_backfill.sql accordingly):
1. Beautycare row (fixed tenant id, is_demo=false) gets the plain derived slug, so her address stays the same and becomes unambiguous.
2. Every other row in a conflict group gets `<derived>-<first 6 hex chars of settings.id>`; recheck uniqueness, STOP on any collision.
3. Non-conflicting rows keep the plain derived slug (as before).
4. Dry run expectation changes from "same_name_salons=0" to "same_name_salons=2, all resolved by rule 1-2, duplicate_after=0".

Future salons: set public_slug when a settings row is created or the salon is named (onboarding saveSalon),
using derived slug, and on unique-index conflict append the short id suffix. Optionally a later NOT NULL/CHECK
once every row has a value. Separate approval needed.
