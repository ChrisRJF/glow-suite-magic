# Veilige Kassa (voorbereid, INACTIEF)

- Migratie: `docs/proposed-migrations/2026-10-12_kassa_orders.sql` (niet toegepast).
- Servercode: `supabase/functions/_shared/inactive/kassaRoute.ts` (door niets geimporteerd).
- Tests: `bash tests/kassa-orders/run-local-pg.sh` (54/54), `bunx vitest run --config tests/kassa-orders/vitest.config.ts` (6/6).

## Nog te plaatsen na GO (in deze volgorde)
1. Migratie als een transactie (alle schakelaars uit). Gevolg: Viva/Mollie-betalingen zijn niet meer handmatig op "betaald" te zetten (GlowPayPage); handmatige betalingen wel.
2. Nieuwe Edge Function `kassa-checkout` (entrypoint rond `startKassaPayment`), `startTerminal` = interne aanroep van `create-viva-terminal-payment` met `metadata.kassa_order_id`; die functie neemt bij dat veld bedrag/modus/klant uitsluitend uit `kassa_begin_attempt`.
3. `viva-terminal-payment-status` en `viva-webhook`: na `record_provider_payment` `afterProviderEvent` aanroepen.
4. Andere routes (`create-payment`, `create-auto-revenue-payment`, niet-checkoutpad `create-viva-payment`) op `kassa_live_allowed` laten weigeren voor live en `is_demo` uit de browser negeren.
5. Frontend Kassa achter `kassa_orders_enabled`.
6. Alleen Studio Nova (demo) aanzetten en testen; live per salon pas na KYC + GO.
