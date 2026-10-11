# Afrekenen vanuit afspraak (gedeployed, alle salons UIT)

- Edge Function `appointment-checkout` (index.ts + core.ts) live; inert zolang `appointment_checkout_enabled` uit staat.
- Providers hebben alleen een extra pad voor betalingen met `metadata.checkout = "appointment_checkout"`; oude betalingen ongewijzigd en nooit herberekend.
- Dat pad accepteert alleen aanroepen van de checkoutroute (header `x-glowsuite-checkout`), bepaalt salon via lidmaatschap (eigenaar/admin/manager/receptie) en demo/live uit salonsettings.
- Live: KYC verplicht (`_shared/checkoutGuard.ts` liveKycReady: merchant, onboarding, kyc_status, setup_complete, terminal- resp. online-bevoegdheid). Demo salon mag nooit de live omgeving raken.
- Grootboek alleen met door Viva/Mollie zelf gerapporteerde bedragen (`_shared/providerLedger.ts`).
- `create-viva-terminal-payment` gebruikt nu `appointments.price` (kolom `total_price` bestaat niet).

Tests: `bunx vitest run --config tests/appointment-checkout/vitest.config.ts` (38/38), `bash tests/appointment-checkout/run-local-pg.sh`.
Praktijktest: alleen Studio Nova Amsterdam `cbd7d158-0133-4f2f-a504-4b82f73f2e20` (demo), na aparte GO en bevoegde login.
