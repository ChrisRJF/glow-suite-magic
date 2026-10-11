# Afrekenen vanuit afspraak (voorbereid, NIET live)

## Onderdelen
- Migratie `docs/proposed-migrations/2026-10-11_appointment_checkout_ledger.sql` (NIET toegepast): flag `appointment_checkout_enabled` (default uit), `payment_ledger` (alleen service_role leest, schrijven alleen via `record_provider_payment`), `appointment_checkout_claims` + claimfuncties. Lokaal getest op lege PG: claim/dubbele claim, aanbetaling+rest, replay, andere salon, verkeerd bedrag/valuta, hergebruikte transactie, approllen geweigerd.
- Kern `supabase/functions/_shared/inactive/appointmentCheckoutCore.ts`, entrypoint-concept `appointmentCheckoutEntry.ts` (niet gedeployed).
- Frontend: `AppointmentCheckoutPanel` in het afspraakvenster, alleen zichtbaar als de flag expliciet `true` is en de rol eigenaar/admin/manager/receptie is. Zonder migratie bestaat de kolom niet: knop verborgen.

## Nog nodig vóór activatie (elk apart goedkeuren)
1. Migratie toepassen.
2. Providerpatches (raken bestaande live betalingen, daarom nog niet gedaan):
   - `viva-terminal-payment-status` en `viva-webhook`: na geverifieerde `paid` `record_provider_payment(tenant, payment, 'viva', transactionId, 'payment', bedragCenten, valuta, bron)` aanroepen; bij mislukking `appointments.payment_status` NIET naar `unpaid` zetten als er grootboekbetalingen zijn; `amount_paid` = som grootboek.
   - `mollie-webhook`: na ophalen bij Mollie-API idem met provider `mollie`; refunds als `kind='refund'`.
   - `create-viva-payment`: bij `payment_type='appointment_checkout'` geen opwaardering naar aanbetalingsbedrag en `paid` niet als duplicaat tellen.
3. Entrypoint plaatsen als Edge Function `appointment-checkout`.
4. Flag alleen aan voor een echte demosalon met Viva-demo-omgeving; fictieve test pin + link.
5. Beautycare pas na expliciete toestemming van Chris.

Tests: `bunx vitest run --config tests/appointment-checkout/vitest.config.ts`.
