# Kassa definitief veilig – ontwerp (NIET actief, wacht op GO)

## Uitgangspunt
Hergebruik `create-viva-terminal-payment`, `viva-terminal-payment-status`, `viva-webhook`, `_shared/checkoutGuard.ts` (resolveCheckoutTenant, tenantIsDemo, liveKycReady, environmentMatches) en `uq_payments_terminal_idempotency`. Geen tweede betaalarchitectuur: de Kassa krijgt alleen een *bestelling* vóór de bestaande betaling, en één *verwerkingsfunctie* erna. Afspraakcheckout en online boeken blijven ongewijzigd.

## 1. Server bepaalt salon, modus, KYC
- Salon = `resolveCheckoutTenant(actor)` via lidmaatschap (eigenaar/admin/manager/receptie/medewerker met kassarecht). Browser stuurt geen tenant, geen `is_demo`, geen bedrag.
- Modus = `tenantIsDemo` uit settings; onduidelijk = 409. Live = `liveKycReady(..., "terminal")` + `environmentMatches`. Terminal wordt binnen salon + modus vertaald (bestaand).
- Nieuw pad in `create-viva-terminal-payment`: bij `kassa_order_id` wordt bedrag/klant/beschrijving **uit de bestelling** gehaald; meegestuurde `amount_cents` wordt genegeerd.

## 2. Server berekent totaal
Nieuwe RPC `kassa_create_order(_request_id uuid, _customer_id uuid, _lines jsonb)` (SECURITY DEFINER, actor = auth.uid()):
- Lines alleen `{type: service|product, item_id, qty 1..99}`, max 50 regels.
- Prijs, naam en actief-status uit `services`/`products` van **dezelfde salon**; klant moet bij salon horen; anders weigeren.
- Bevriest regels + `total_cents` in `kassa_orders`/`kassa_order_lines`. Idempotent op `(tenant_id, request_id)`: zelfde ID + andere inhoud = `conflict`.
- Voorraad wordt hier alleen gecontroleerd (waarschuwing), niet gereserveerd.

## 3. Precies één keer verwerken na bevestiging
RPC `kassa_settle_order(_payment_id uuid)`, alleen `service_role`, aangeroepen door status-poll én webhook na `paid`:
- `SELECT ... FOR UPDATE` op order; vereist `payments.status='paid'`, payment hoort bij order + salon, `round(amount*100) = total_cents`.
- Eén transactie: status `open → settled`, voorraad `products.stock = stock - qty`, `customers.total_spent += total`, `checkout_items` schrijven.
- Tweede aanroep: order al `settled` → `duplicate`, niets gedaan.
- Onvoldoende voorraad: betaling is al echt, dus **niet** blokkeren; stock wordt maximaal tot 0 verlaagd en `stock_shortfall` op de regel vastgelegd + admin-melding. Nooit negatieve voorraad, nooit stille verwerking.
- Onderbroken: `settle` is volledig atomair; mislukt = rollback, order blijft `payment_paid_unsettled`. Een herhaalde poll/webhook of dagelijkse reconcile (bestaande `viva-payment-reconcile`) roept dezelfde functie opnieuw aan.
- Statussen: `draft` (geen betaalverzoek) → `payment_open` (Viva-betaling bestaat, `payment_id` gekoppeld) → `settled` | `payment_failed` (terug naar herstartbaar) | `cancelled`.

## 4. Meerdere medewerkers en apparaten
- `kassa_list_open_orders()`: alleen orders van eigen salon + eigen modus (demo/live). Een ander apparaat kan zo een `payment_open` hervatten (statuscontrole met zelfde `payment_id`) of een `draft` afmaken.
- Eén actieve Viva-betaling per order: partial unique index op `kassa_orders(id) WHERE status='payment_open'` + idempotency key = `kassa:<order_id>:<attempt>`; nieuwe poging alleen na provider-finale mislukking.
- Huidige localStorage-pending blijft alleen als snelkoppeling naar `order_id`.

## Minimale databasewijzigingen
- `kassa_orders` (id, tenant_id, is_demo, request_id, customer_id, total_cents, status, payment_id, attempt, created_by, settled_at; UNIQUE(tenant_id, request_id)).
- `kassa_order_lines` (order_id, type, item_id, name, unit_cents, qty, stock_shortfall).
- 4 RPC's hierboven. Beide tabellen: RLS aan, **geen** directe schrijfrechten voor anon/authenticated/sandbox_exec; lezen alleen via RPC. `kassa_settle_order` uitsluitend service_role.
- Per-salon flag `tenant_feature_flags.kassa_orders_enabled` default false.

## Beveiligingsregels
- Actor uitsluitend uit JWT; salon via lidmaatschap; elke regel/klant/terminal/payment gecontroleerd op `tenant_id` + `is_demo`.
- Browser kan bedrag, modus, salon en betaalstatus niet bepalen; alleen providerbevestigde `paid` triggert verwerking.
- Bestaande Kassa-flow blijft actief zolang flag uit is.

## Tests (fictief, lokale PG + Vitest)
Verkeerde salon (product/klant/terminal/order van salon B) geweigerd; gemanipuleerd bedrag genegeerd; prijswijziging na order beïnvloedt totaal niet; dubbele `create_order` en dubbele settle (poll + webhook parallel) = één mutatie; onvoldoende voorraad; rollback halverwege + herstart; hervatten op tweede apparaat; demo-order kan geen live terminal; live zonder KYC geblokkeerd; failed → nieuwe poging zonder dubbele betaling.

## Activatievolgorde
1. Migratie op tijdelijke testdatabase + tests. 2. Migratie productie (één transactie, flag overal uit). 3. Edge-patches (create/status/webhook) deployen, inert zonder flag. 4. Frontend achter flag. 5. Alleen Studio Nova (demo) aan, praktijktest. 6. Pas daarna andere salons; Beautycare alleen met Chris' GO.
