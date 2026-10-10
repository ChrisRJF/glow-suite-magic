# public_slug fill: side-effect review (offline, 2026-10-11)

No production queries, writes, deploys or publications. Source code only.

## 1. Sender address (send-white-label-email `uniqueSalonSlug`)
- Display name: always `salon_name`. Unchanged.
- Reply-To: salon contact email / branding / profile email. Unchanged.
- From local part: when the caller passes `salon_slug` OR settings has `public_slug`,
  local part = slug; otherwise slug(name) + first 8 chars of user_id.
  - Booking confirmations (public-booking), payment mails (mollie/viva-webhook),
    shop and membership mails already pass `salon_slug` -> already name-only today. No change.
  - Reminders (whatsapp-reminder-scheduler email path) pass `public_slug || undefined`
    -> today name+8, after fill name-only. Only real change.
- Preserve fully: `patch-sender-stable.diff` (inactive) makes the suffix rule
  depend only on the caller-provided slug, not on stored public_slug.
  Alternative: accept the change (same domain, same display name, same Reply-To).

## 2. Rebook links (auto-rebook-send, _shared/autoRebookPass)
- Today, without public_slug: `/boeken?rb=token` = page without salon context, so
  the customer does not reach the salon's booking page (existing defect).
- After fill: `/boeken/<slug>?rb=token&svc=...` = own salon page; server validates
  the token per salon. Improvement, no active code change needed.

## 3. Shop / memberships
- public-shop and public-memberships already fall back to name matching, so they are
  reachable today; the fill does not newly expose them (earlier note corrected).
- Shop: blocked by `webshop_enabled` (403). Memberships: open unless
  `whitelabel_branding.membership_features.white_label_signup/member_portal` is false
  (defaults true). Existing exposure, unrelated to the fill; separate decision.

## 4. Scope
- Migration unchanged. Expected count in dry run must match; the real live salon
  (Beautycare) is included, which needs Chris's explicit approval at fill time.
- Smaller option: fill only the live account and leave demo/test accounts on name
  fallback (still works on current server; would break on the new server).
- New salons: onboarding must set public_slug (separate follow-up).
