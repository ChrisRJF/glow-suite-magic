# WhatsApp-verzending: compatibiliteitsmatrix, uitrol- en terugvalplan (ronde 8C, NIET uitgevoerd)

Status: voorstel. Niets hiervan is toegepast, gedeployed of geactiveerd.

## 1. Compatibiliteitsmatrix (16 aanroeproutes, read-only)

Legenda nieuwe guard: Ident = vereiste geverifieerde identiteit; Event = vereiste `event_ref`/`action_id`.
Alle 12 serverroutes sturen nu alleen `Authorization: Bearer <service role key>` en een vrij `user_id`: ze vallen onder de nieuwe guard **allemaal** uit (geen HMAC v2-handtekening) tot ze zijn aangepast.

| # | Route | Soort (kind) | Ident | Nodig | Ontbreekt nu | Effect nieuwe guard | Latere aanpassing |
|---|---|---|---|---|---|---|---|
| 1 | WachtlijstPage | waitlist_offer (marketing) | JWT, eigenaar/admin/manager/receptie | customer_id, action_id | action_id; marketing_consent vaak leeg | 422 zonder action_id; 409 zonder marketing_consent | action_id per klik |
| 2 | WhatsAppTemplatesCard (test) | test | JWT eigenaar/admin | customer_id met opt-in | stuurt alleen vrij `to`, geen klant | 422 recipient_unverified | testontvanger kiezen uit eigen klanten |
| 3 | WhatsAppConnectionCard (test) | test | idem | idem | idem | 422 | idem |
| 4 | CampaignEditor test | campaign_test | idem | idem | idem | 422 | idem |
| 5 | CampaignEditor verzenden | campaign (marketing) | JWT eigenaar/admin/manager | customer_id, action_id per ontvanger | action_id | 422; daarna alleen klanten met opt-in + marketing_consent | action_id per campagne+ontvanger, opgeslagen voor retries |
| 6 | whatsapp-reminder-scheduler retry (r.271) | reminder/review/no_show uit log | HMAC reminder-scheduler | event_ref uit oorspronkelijke send | event_ref, signatuur | 401 | event_ref in log bewaren |
| 7 | reminder-scheduler review (r.518) | review (marketing) | HMAC | `appointment:<id>` | signatuur, event_ref | 401; daarna marketing_consent vereist | ondertekenen |
| 8 | reminder-scheduler no-show (r.628) | no_show (voorstel transactioneel) | HMAC | `appointment:<id>` | idem | 401 | idem + beleidsbesluit |
| 9 | _shared/sendAppointmentReminder | reminder | HMAC reminder-scheduler | `appointment:<id>:<24h/2h>` | signatuur, slot | 401 | slot = reminder_type |
| 10 | automation-scheduler | automation (marketing) | HMAC | customer_id, `automation_run:<id>` | **customer_id = null**, signatuur | 401; daarna 422 recipient_unverified | klant meesturen, run-id als event |
| 11 | auto-rebook-send | auto_rebook (marketing) | HMAC auto-rebook | `rebook_action:<id>` | signatuur, event_ref | 401 | rebook_actions.id meesturen |
| 12 | _shared/autoRebookPass | auto_rebook | idem | idem | idem | 401 | idem |
| 13 | public-booking | confirmation (voorstel transactioneel) | HMAC booking-confirmation | `appointment:<id>` | signatuur | 401; daarna klanten zonder expliciete opt-in geblokkeerd | ondertekenen + besluit |
| 14 | mollie-webhook | confirmation | HMAC payment-webhook | `appointment:<id>` | signatuur | 401; dedupe met #13/#15 werkt | ondertekenen |
| 15 | viva-webhook | confirmation | HMAC payment-webhook | `appointment:<id>` | signatuur | 401 | ondertekenen |
| 16 | customer-forms + _shared/dossierForms | form_request / form_reminder | HMAC customer-forms | `form_request:<id>[:slot]` | signatuur, event_ref | 401 | form_requests.id meesturen |

(Rij 16 omvat twee aanroeppunten met dezelfde caller; CampaignEditor telt als één UI-bestand met twee paden.)

Extra effect voor alle routes: klanten met `whatsapp_opt_in = null` worden geweigerd (geen backfill). In de huidige data kan dat het grootste deel van de klanten zijn; dit moet vóór livegang in aantallen gemeten worden (alleen tellen, niets wijzigen).

## 2. Beleidsbesluiten voor de projecteigenaar (open)

1. Zijn boekingsbevestiging, betalingsbevestiging, no-show-melding en formulierverzoeken transactioneel? (voorstel: ja, maar altijd met expliciete WhatsApp-opt-in en STOP).
2. Reviewverzoek, campagne, wachtlijst, Auto Rebook, automations: marketing (marketing_consent vereist). Bevestigen.
3. Hoe wordt WhatsApp-opt-in voortaan verzameld (boekingsformulier, kassa)? Geen backfill van bestaande klanten zonder bewijs.
4. Bewaartermijn claims (voorstel 400 dagen) en nonces (vervallen na 10 min).
5. Rollen voor handmatig versturen (voorstel: eigenaar, admin, manager, receptie; test alleen eigenaar/admin).
6. Toegestane testontvangers: alleen eigen klant met opt-in (voorstel) of aparte geverifieerde testnummers.

## 3. Minimale eerste productiepatch (pas na aparte goedkeuring)

Doel: onmiddellijk weigeren van niet-geauthenticeerde en cross-tenant verzoeken, zonder Gateway.

Fase 0 (zonder live effect): DB-voorstel `2026-10-10_whatsapp_send_claims_nonces.sql` beoordelen; per caller een secret (>= 32 bytes) aanmaken in config-formaat `{"current":"1","keys":{"1":"<Base64>"}}`; meting consentdekking.
Fase 1: tabellen/functies toepassen (alleen nieuwe objecten, niets bestaands gewijzigd).
Fase 2: callers 6-16 laten ondertekenen met HMAC v2 en `event_ref` meesturen, **terwijl** de oude functie nog draait (extra headers worden genegeerd). Per caller in de logs controleren dat handtekening + event_ref aanwezig zijn.
Fase 3: `whatsapp-send` vervangen door wrapper: `Authorization` met service key telt niet meer; alleen (a) gebruikers-JWT via `auth.getUser` of (b) geldige HMAC v2 + nonce. Body `user_id` moet gelijk zijn aan de afgeleide salon. UI-routes 1-5 krijgen tegelijk `action_id` en klantkeuze voor tests.
Fase 4: strikte consent aanzetten (kan apart, nadat besluiten 1-3 genomen zijn). Tot dan geldt in fase 3 minimaal: STOP/preference-opt-out blokkeert, opt-in `false` blokkeert.

Volgorde is: database → callers ondertekenen → verzendfunctie afdwingen → consent aanscherpen.

## 4. Terugvalplan (fail-closed)

Teruggaan naar de huidige kwetsbare functie is geen standaard rollback.

- Noodschakelaar: per-tenant/globale vlag "WhatsApp-verzending gepauzeerd" (bestaand patroon `tenant_feature_flags`), standaard uit. Bij problemen aan: `whatsapp-send` antwoordt 503 `sending_paused`, maakt geen claim en roept de provider niet aan.
- Afspraken, klanten, betalingen en herinneringsplanning worden niet gewijzigd; schedulers loggen "niet verzonden" zodat het zichtbaar blijft.
- Claims in `claimed`/`unknown` worden nooit automatisch opnieuw verzonden; een medewerker beoordeelt ze.
- Bij een fout in één caller: alleen diens sleutel uit de config halen (die caller krijgt 401), de rest blijft werken.
- Herstel = gecorrigeerde patch opnieuw uitrollen, niet de oude code.

## 5. Nog ontbrekende voorzieningen

- Toegepaste claims/nonce-tabellen (nu alleen lokaal getest).
- Secrets per caller en een HMAC-signeerhelper in elke caller.
- `event_ref` in `whatsapp_logs`/retry-pad; `customer_id` in automation-runs.
- Opt-in-verzameling + meting van huidige dekking.
- STOP-lijst per salon (Gateway-voorstel ronde 7) gekoppeld aan `isStopped`.
- Noodschakelaar-vlag.
