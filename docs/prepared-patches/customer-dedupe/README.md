# Customer dedupe (exact pairs) - offline, NOT applied

Status: NO-GO for production until the blockers below are closed. Nothing here is imported by active code.

## Files
- `docs/proposed-migrations/2026-10-10_customer_dedupe_exact_pairs.sql` - columns, batch/pair log, `dedupe_preview`, `dedupe_apply(batch, dry_run)`, `dedupe_undo`. service_role only.
- `src/test/sql/run-local-pg-customer-dedupe.sh` (+ `customer-dedupe-sim*.sql`) - throwaway socket-only PostgreSQL, synthetic data.
- `docs/proposed-migrations/2026-10-10_customer_merge.sql` - superseded, must NOT run (moves rows, no undo).

## Design
- Scope: only groups of exactly 2 records with equal normalised name + email + phone and identical
  privacy/marketing/WhatsApp/communication-block/language values. Name-differing pairs, consent-differing
  pairs, groups > 2 and weak matches are only counted for manual review.
- Survivor: oldest `created_at`, then lowest id. Both ids kept.
- Apply marks the duplicate `merged_into/merged_at/merge_batch_id`. No delete, no row moves, no consent
  change, `updated_at` untouched. Full original row stored as snapshot in `customer_merge_pairs`.
- Per pair re-check under row lock at apply: unchanged since preview, unmerged, no legal hold, 0 refs in
  all 33 linked tables (missing table aborts). Otherwise skipped with a reason.
- Re-apply is a no-op. Undo restores exactly and refuses if a merged row was edited afterwards.
- Audit rows hold counts and batch id only, no personal data.

## Consumers that must ignore `merged_into IS NOT NULL` BEFORE apply (blocker)
Customer list/search/count, duplicate review, import dedupe (match survivor), public-booking customer
lookup by email/phone, MCP customer search, automation scheduler, campaigns/segments, WhatsApp/email
senders, reports, memberships/loyalty, privacy export (must include merged records).

## Open blockers
1. No verifiable project-scoped backup snapshot available to the agent (see report).
2. Consumer filter patch not written/approved.
3. Migration + functions not yet approved for production.
