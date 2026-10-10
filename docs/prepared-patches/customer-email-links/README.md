# Prepared patch: customer email links + email authorization (INACTIVE)

Status: offline only. No active Edge Function changed. Activation requires separate approval.

## Causes
- Links: `send-white-label-email`, `public-booking` and `automation-scheduler` build `https://<slug>.glowsuite.nl/...`. Salon subdomains are not served (only glowsuite.nl / www). Two slug rules also differ: the email function strips hyphens (`studiofictief`), the callers keep them (`studio-fictief`).
- Manage link: `public-booking` passes no `manage_url`, so the fallback `/afspraak/beheer` is used ("beheer" is not a valid token). `automation-scheduler` falls back to the appointment id when there is no booking_token.
- Calendar: `/calendar/.../*.ics` has no endpoint anywhere.
- Authorization: `send-white-label-email` uses the service role and trusts `user_id` from the body, for previews and sends alike.

## Solution (modules in supabase/functions/_shared/inactive/)
- `emailLinks.ts`: main domain only; salon = stored `public_slug` (same lookup as public-booking); manage = `/mijn-afspraak/<booking_token uuid>`; booking/rebook = `/boeken/<public_slug>`; route = `/route-contact`; terms = `/salonvoorwaarden`; `calendarUrl` always undefined (button hidden). Caller links are accepted only if `isAllowedCustomerUrl` / `isSalonBookingUrl` is true.
- `icsBuilder.ts`: ready for a future endpoint (TZID Europe/Amsterdam, validation). No endpoint built.
- `emailSendAuth.ts` (existing): JWT + tenant + role (eigenaar/admin/manager), same for preview_only; service-role callers keep working.

## Active functions to change later (each needs approval)
1. `send-white-label-email`: call `authorizeEmailRequest` first; build links with `buildCustomerEmailLinks(settings.public_slug, template_data.booking_token)`; drop subdomain `publicBaseUrl`; drop `calendar_url`.
2. `public-booking`: pass `booking_token`, stop sending `calendar_url`.
3. `automation-scheduler`: pass `booking_token` only (no appointment-id fallback), stop sending subdomain URLs.
4. `src/pages/AdminEmailTemplatesPage.tsx`: preview passes the same inputs (no calendar URL), so preview equals the real mail.
5. Optional, separate decision: a public `.ics` endpoint by booking_token using `icsBuilder.ts`, then re-enable the calendar button.

## Known limits
- `/route-contact` and `/salonvoorwaarden` exist but are generic pages without salon-specific address or terms.
- Salons without a `public_slug` get no booking button.
- Later: per-automation signed keys instead of the shared service key.
