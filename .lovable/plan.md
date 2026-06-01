# Multilingual Foundation for GlowSuite Customer Experience

This is a large, multi-layer change (i18n framework, ~20 customer-facing pages, DB column, settings UI, email templates, WhatsApp templates, SEO). I'll deliver it in **3 phases** so each phase ships verified and stable, instead of one giant unreviewable change.

## Architecture

**Library**: `i18next` + `react-i18next` + `i18next-browser-languagedetector` (industry standard, scalable, supports namespaces and pluralization, future-proof for RTL/Arabic).

**Translation files**: `src/i18n/locales/{nl,en,de,fr,es}.json` with nested namespaces:
```
common, booking, customer, membership, giftcard, payment,
waitlist, review, intake, errors, validation
```

**Detection order**: URL `?lang=` → localStorage (`glowsuite_lang`) → customer profile (when logged into portal) → browser `navigator.language` → fallback `nl`.

**Persistence**:
- `localStorage.glowsuite_lang`
- URL query param (kept in sync on change)
- New DB column `customers.preferred_language text default 'nl'`
- Booking payload includes `language` so server-side email/WhatsApp jobs use it

**Salon content rule**: Only UI strings translated. Service names, category names, descriptions, custom WhatsApp templates, and salon-authored copy stay in original language.

## Phase 1 — Foundation + booking flow (this turn)

1. Install `i18next react-i18next i18next-browser-languagedetector`.
2. Create `src/i18n/index.ts` (init), `src/i18n/locales/*.json` (5 files, full booking + common strings).
3. Initialize in `src/main.tsx`.
4. `src/components/LanguageSwitcher.tsx` — flag dropdown (🇳🇱🇬🇧🇩🇪🇫🇷🇪🇸), keyboard accessible, white-label safe (uses semantic tokens).
5. `src/hooks/useLanguagePersistence.ts` — syncs URL ↔ localStorage ↔ i18n.
6. DB migration: `ALTER TABLE customers ADD COLUMN preferred_language text DEFAULT 'nl'`.
7. Translate **BookingPage** (service / category / staff / date / time / customer form / confirm / success / failed) end-to-end + mount language switcher in header.
8. Translate `PaymentSuccessPage`, `PaymentFailedPage`, `MollieCallbackPage`, `PublicActionPage` (reschedule/cancel/waitlist confirms).
9. SEO: dynamic `<title>` + `<meta description>` via `document.title` per route + `hreflang` link tags for booking page.

## Phase 2 — Portal, memberships, giftcards, intake, reviews

1. Translate `MembershipPortalPage`, gift card public flows, intake forms, review request pages, client login area, referral pages.
2. Persist customer `preferred_language` on first booking and on every language change while logged in.
3. Localize embeddable `public/widget.js` + `public/shop-widget.js` (accept `data-lang` attr, ship inline translations).

## Phase 3 — Server-side localization + admin settings

1. **Admin settings**: `Instellingen → Booking Experience → Languages` panel with default language dropdown + two toggles (allow customer switch, auto-detect browser). Stored in `settings.booking_languages` jsonb.
2. **Email templates**: Add language switch in `glowsuiteEmail.ts` shared util; provide NL/EN/DE/FR/ES copy for booking confirmation, reminder, reschedule, cancel, membership, giftcard, review, payment confirm, payment reminder. Each edge function reads `customer.preferred_language` (or booking payload) and picks the matching template.
3. **WhatsApp/SMS**: Extend `DEFAULT_WHATSAPP_TEMPLATES` in `src/lib/whatsappTemplates.ts` to `Record<Lang, Record<TemplateType, string>>`. `whatsapp-send` edge function picks language from customer profile, falls back to `nl`. Salon's custom overrides win when present (salon content rule).

## Technical details

- **Detection helper** lives in `src/i18n/detect.ts`, returns one of the 5 supported codes; unknown → `nl`.
- **Hreflang**: rendered via `react-helmet-async` (already documented in head-meta knowledge); add to booking + portal pages with the 5 alternates + `x-default`.
- **Future languages** (it, pt, pl, ar): add a new JSON file + entry in `SUPPORTED_LANGUAGES` const. RTL handled by `<html dir>` toggle hook ready in `src/i18n/index.ts`.
- **No dashboard changes** — `LanguageSwitcher` is only mounted on customer-facing routes. Dashboard keeps current Dutch UI.
- **GlowPay**, **GlowSuite**, **Sunmi**, salon names, service names — never translated.

## Files touched (Phase 1)

```text
package.json                              (deps)
src/main.tsx                              (i18n init)
src/i18n/index.ts                         (new)
src/i18n/detect.ts                        (new)
src/i18n/locales/{nl,en,de,fr,es}.json    (new × 5)
src/components/LanguageSwitcher.tsx       (new)
src/hooks/useLanguagePersistence.ts       (new)
src/pages/BookingPage.tsx                 (translate)
src/pages/PaymentSuccessPage.tsx          (translate)
src/pages/PaymentFailedPage.tsx           (translate)
src/pages/MollieCallbackPage.tsx          (translate)
src/pages/PublicActionPage.tsx            (translate)
supabase/migrations/<ts>_customer_lang.sql (new)
```

## Deliverable after each phase

Concise summary of: files changed, strings covered, what's intentionally left for next phase, and any QA notes.

---

**Please confirm**: ship Phase 1 now (foundation + booking + payment pages), then Phase 2, then Phase 3? Or do you want a different split (e.g., all UI first, server-side last)?
