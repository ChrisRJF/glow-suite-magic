# Afrekenen vanuit afspraak (INACTIEF, NO-GO live)

Niet geïmporteerd door `src/` of een Edge Function. Geen DB, geen deploy, geen betalingen.

## Bevindingen (bestaande code)
| Flow | Herbruikbaar? | Reden |
|---|---|---|
| `KassaPage.handlePay` | NEE | Client schrijft `payments.status='paid'`, checkout_items en `total_spent` zonder providerbevestiging. |
| `create-payment` (Mollie) demo-pad | NEE | Kiest willekeurig paid/failed en schrijft `amount_paid` van de afspraak direct. |
| `TerminalPaymentDialog` + `create-viva-terminal-payment` + `viva-terminal-payment-status` | DEELS (UI ja) | Auth/tenant ok, terminal-eigendom ok, paid alleen via providerpoll, `.neq('status','paid')`. Gaten: bedrag komt van client en wordt alleen begrensd als openstaand > 0; geen blokkade op lopende terminalbetaling per afspraak; bij succes `payment_status='paid'` zonder `amount_paid`; bij mislukking `payment_status='unpaid'` (overschrijft een eerdere aanbetaling). |
| `create-viva-payment` (betaallink) + `viva-webhook` | DEELS | Tenantcheck en duplicate-blokkade ok, maar die blokkade telt ook `paid` mee (restbedrag na aanbetaling onmogelijk), bedrag niet begrensd op openstaand, en webhook zet `amount_paid` = dit ene bedrag en zet bij mislukking afspraak naar `pending_confirmation`/`payment_failed`. |
| Contant | GEEN veilige bestaande flow | Daarom niet aangeboden. |

## Ontwerp
- In het bestaande afspraakvenster één knop **Afrekenen**, alleen voor eigenaar/admin/manager/receptie. Toont openstaand bedrag (server). Keuze: "Pinapparaat" (bestaande TerminalPaymentDialog) of "Betaallink".
- Browser stuurt alleen `appointment_id`, methode, terminal en fooi. Server (`appointmentCheckoutCore.ts`) bepaalt salon, bedrag = prijs min **providerbevestigde** betalingen, blokkeert geannuleerd/no-show, refunds, lopende betaling, volledig betaald, onleesbare data en niet-gereed provider. Idempotency-sleutel `appt-checkout-<id>-<betaaldCenten>`.
- Statussen: Starten -> Wachten op betaling -> Betaald (alleen bij server status `paid`) of Mislukt. Geen client-write, `total_spent` niet vooraf.

## Blokkades (NO-GO live)
1. Nieuwe Edge Function `appointment-checkout` (deze kern) + unieke claimtabel (`docs/proposed-migrations/`, nog te schrijven) nodig. Claim/idempotency is nu alleen met mocks getest, niet in een database.
2. Terminal-statuspoll en `viva-webhook` moeten bij een afspraakbetaling `amount_paid` optellen uit bevestigde betalingen, `payment_status` alleen `paid` bij volledig betaald (anders `deposit_paid`/partial), en bij mislukking de vorige status laten staan. Zonder die patch kan een aanbetaalde afspraak na een mislukte pin als onbetaald of na restbetaling met verkeerd `amount_paid` worden getoond.
3. `create-viva-payment` duplicate-check moet `paid` niet meer als blokkade tellen wanneer er nog openstaand is; bedrag server-side begrenzen.
4. `total_spent` alleen server-side na bevestigde betaling (nu nergens veilig voor deze route).
5. Frontendknop pas bouwen na 1-4; geen halfwerkende knop.

## Uitrol (elk apart goedkeuren)
1. Review + migratie claimtabel. 2. Patches poll/webhook/create-viva-payment, eerst testen met Viva demo. 3. Deploy `appointment-checkout`. 4. Knop achter per-salon flag, aan voor demo-salon Mijn Salon, één fictieve demo-betaling via terminal-demo. 5. Pas daarna, met expliciete toestemming van Chris, Beautycare.

Tests: `bunx vitest run --config tests/appointment-checkout/vitest.config.ts`.

## Correctie 2026-10-11 (P0 review)
1. **Prijs**: alleen de vastgelegde `appointments.price`. Null/0/ongeldig = stop (`no_price`); geen terugval op de huidige behandelprijs. Groepsboeking (`booking_group_id`) en aanbetaling > prijs = fail closed.
2. **Betaald is geen bewijs**: een `payments`-rij met `status='paid'` telt niet mee. RLS laat salongebruikers `payments` invoegen/wijzigen (incl. `provider`, `metadata`, `webhook_received_at`, `mollie_payment_id`, `amount`); KassaPage schrijft zelf `paid`/`glowpay`. Daarom zijn al die velden onbetrouwbaar.
   - Enige server-only spoor vandaag: `payment_status_history` (authenticated alleen SELECT), geschreven door `viva-terminal-payment-status` (poll) en `viva-webhook` (webhook). Dit bevat **geen bedrag** en het schrijven is best-effort (fout wordt alleen gelogd).
   - `mollie-webhook` schrijft geen beschermd spoor: Mollie-betalingen zijn niet verifieerbaar.
   - Gevolg: elke afspraak met een `paid`-rij of `amount_paid` > 0 wordt nu geblokkeerd (`unverified_payment`). Alleen volledig onbetaalde afspraken zouden kunnen starten.
3. **Refunds**: `refunded_amount` > 0, `refunded_at` of refundstatus blokkeert (`refund_present`) tot er veilige reconciliatie is. Onbekende status of onleesbare data blokkeert ook (`uncertain_status`).

## Extra blokkade (NO-GO live)
6. Een server-only betalingsgrootboek met bevestigd bedrag per providertransactie (Viva en Mollie), niet schrijfbaar door app-gebruikers, plus intrekken van client INSERT/UPDATE op provider-velden van `payments`. Zonder dit is een aanbetaling niet verifieerbaar en kan restbedrag niet veilig berekend worden. Voorstel nog niet geschreven; vereist aparte goedkeuring.
