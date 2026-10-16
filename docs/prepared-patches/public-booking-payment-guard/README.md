# Public booking deposit guard (prepared, NOT wired, NOT deployed)

Problem: `public-booking/index.ts:585-665` (and `create-auto-revenue-payment`) call `createVivaOrder`
with platform credentials (`VIVA_CLIENT_ID`, `VIVA_SOURCE_CODE`) for every non-demo salon, without
merchant/KYC checks. Funds would land on GlowSuite. SaaS endpoints (`saas-*-viva`) are GlowSuite's
own revenue and correctly use platform credentials.

Prepared: `supabase/functions/_shared/inactive/publicBookingPaymentGuard.ts`
(tests: `tests/viva-isv/public-booking-payment-guard.test.ts`).

Wiring (needs separate GO + deploy of public-booking and create-auto-revenue-payment):
1. Replace the `provider === "viva"` non-demo branch: call `livePaymentGate(tenant,"link",...)`,
   load existing payments for the appointment, call `decidePublicBookingPayment`.
2. `no_charge_pending`: no provider call, no payment row, appointment `payment_status = payment_pending`,
   response `paymentInitError` "Je afspraak is vastgelegd. De salon neemt contact op over de betaling."
3. Never call `createVivaOrder` (platform credentials) for salon money again.

Blocker before real salons can take online deposits:
- A LIVE ISV order builder (`/checkout/v2/isv/orders?merchantId=` with LIVE ISV credentials,
  storing `metadata.viva_merchant_id`) and LIVE webhook confirmation via ISV transaction lookup.
  Only the demo builder exists. `LIVE_ISV_ORDER_ROUTING_AVAILABLE` stays false until built,
  tested against Viva demo, and approved.
- No salon is KYC verified (Beautycare not onboarded, DigitalHippo pending).
