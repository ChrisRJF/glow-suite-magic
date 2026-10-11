# Afrekenen vanuit afspraak (grootboek live, checkout NIET live)

## Status
- Migratie toegepast (2026-10-11, één transactie): `payment_ledger`, `appointment_checkout_claims`, `record_provider_payment`, `appointment_ledger_totals`, claimfuncties, flag `appointment_checkout_enabled` (alle salons UIT). Alleen service_role leest; schrijven alleen via de functie. anon/authenticated/sandbox_exec geen rechten.
- Route: `supabase/functions/_shared/inactive/appointmentCheckoutEntry.ts` + `appointmentCheckoutCore.ts` (niet gedeployed).
  - prijs = `appointments.price`; betaallink = `payments.metadata.checkout_url`;
  - browser stuurt intern `viva_terminals.id`, server vertaalt naar provider-`terminal_id` binnen salon + modus;
  - demo/live uit `settings.is_demo/demo_mode` en doorgegeven als `is_demo`; providerReady eist `viva_demo_enabled` resp. `viva_live_enabled`.
- Providerstap: `supabase/functions/_shared/inactive/providerLedger.ts` (`applyEvidence`, `syncAppointment`).

## Providerpatches (voorbereid, NIET gedeployed, aparte GO)
Gebruik in elk bestand `applyEvidence` pas NA providerverificatie, en vervang elke directe schrijf naar `appointments.amount_paid/payment_status` door `syncAppointment`.
1. `viva-terminal-payment-status` r.210-214: bij `paid` → `applyEvidence({provider:'viva', transactionId: Viva transactionId, kind:'payment', amountCents: Viva amount, source:'poll'})`; bij failed/cancelled/expired → `syncAppointment` i.p.v. `payment_status='unpaid'`.
2. `viva-webhook` r.586-725: na ophalen transactie bij Viva → `applyEvidence(... source:'webhook')`; refunded/partially_refunded/reversed → `kind:'refund'` met refund-transactie-ID; `amount_paid: 0` bij reversal vervalt (komt uit grootboek).
3. `mollie-webhook` r.123-135: na `GET /payments/{id}` bij Mollie → `applyEvidence({provider:'mollie', transactionId: tr_id, ...})`; refunds via `/refunds` als `kind:'refund'`; mislukt → `syncAppointment`.
4. `create-viva-payment` r.35/80-111: `payment_type` uitbreiden met `appointment_checkout` (opslaan als `full`); dan geen ophoging naar aanbetaling en bestaande `paid`-rij niet als duplicaat tellen (de checkoutroute rekent al restbedrag uit grootboek).
5. Entrypoint plaatsen als Edge Function `appointment-checkout`.

## Tests (fictief)
- `bunx vitest run --config tests/appointment-checkout/vitest.config.ts` (18/18)
- `bash tests/appointment-checkout/run-local-pg.sh` (25/25: aanbetaling+rest, replay, dubbele claim, andere salon, bedrag/valuta, refunds, rechten)

## Praktijktest
Alleen Studio Nova Amsterdam `cbd7d158-0133-4f2f-a504-4b82f73f2e20` (demo, Viva demo aan, live uit, 1 terminal). Beautycare pas na toestemming van Chris.
