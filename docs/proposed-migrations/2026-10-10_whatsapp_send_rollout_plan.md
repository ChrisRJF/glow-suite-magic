# WhatsApp-verzending: compatibiliteitsmatrix, uitrol- en terugvalplan (ronde 8C, herzien in 8D, NIET uitgevoerd)

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

## 2. Voorgestelde indeling (nog GEEN definitief beleid)

Transactioneel (onder voorbehoud): boekingsbevestiging, betalingsbevestiging, afspraakherinnering, no-showmelding, formulierverzoek.
Marketing: reviewverzoek, campagne, wachtlijstaanbod, Auto Rebook, marketingautomatisering, vrije handmatige berichten.
Geen categorie omzeilt STOP of de voorkeur `whatsapp_opt_out`; geen categorie maakt toestemming aan; geen backfill.

Gevolgen: klanten met `whatsapp_opt_in` leeg krijgen niets, ook geen herinnering. Marketingstromen vereisen daarnaast `marketing_consent = true`. Het aandeel geblokkeerde klanten moet vooraf alleen geteld worden.

Open besluiten: (1) indeling hierboven; (2) hoe opt-in voortaan wordt verzameld; (3) bewaartermijn claims 400 dagen (+30 bij onzekere uitkomst) en nonces 10 minuten; (4) rollen handmatig versturen; (5) testontvangers.

## 3. Uitrolvolgorde (alles na aparte goedkeuring per stap)

Er is geen tussenfase met alleen authenticatie. Zodra de nieuwe `whatsapp-send` actief wordt, gelden vanaf het eerste verzoek ALLE controles: geverifieerde identiteit, juiste salon en rol, ontvanger = eigen klant met opgeslagen nummer, geblokkeerde/gearchiveerde/gepseudonimiseerde klanten geweigerd, STOP via Gateway-adapter, `whatsapp_opt_out`, vastgestelde toestemmingsregels (onbekend = nee), verificatie van de zakelijke gebeurtenis en een verzendclaim vóór providercontact. Stromen die daar niet aan voldoen staan gepauzeerd (geen verzending, wel log "niet verzonden"); afspraken, klanten en betalingen blijven ongewijzigd.

1. Controle 16 aanroeproutes (tabel hierboven), per route vastleggen wat ontbreekt.
2. Databasevoorzieningen: claims/nonces, `gateway_tenant_links`, `whatsapp_opt_outs` + `whatsapp_is_opted_out`, noodschakelaar-vlag in `tenant_feature_flags`. Eerst op staging.
3. Toestemming: besluiten nemen, opt-in-verzameling bouwen, dekking alleen tellen.
4. Interne ondertekening: per caller secret (>= 32 bytes), contact-ref-sleutelring.
5. Callers aanpassen (apart traject): HMAC v2, `event_ref` (reminders `:24h` / `:2h`, nu nog gedeelde markering), `customer_id` bij automations. Oude functie negeert extra velden.
6. Nieuwe `whatsapp-send` uitrollen met noodschakelaar standaard AAN (gepauzeerd) voor alle salons. Pas dan zijn de controles actief zonder providercontact.
7. Testen op aparte demo-/stagingomgeving met fictieve klanten en gemockte of sandbox-provider.
8. Per salon pauze opheffen, eerst demo, daarna één echte salon na toestemming. The Beautycare Clinic alleen na expliciete goedkeuring van Chris.
9. Monitoring: weigerredenen per salon, claims `unknown`, 503-percentage; noodstop bij afwijking.

Bewaartermijn: claims >= 400 dagen, onzekere claims 430 dagen. Na verlopen kan dezelfde sleutel opnieuw worden geclaimd; callers mogen daarom nooit een actie of gebeurtenis ouder dan 400 dagen opnieuw aanbieden (huidige retries: minuten).

## 4. Terugvalplan (fail-closed)

- Noodschakelaar aan: 503 `sending_paused`, geen claim, geen providercontact.
- Geen automatische retries van `claimed`/`unknown`; medewerker beoordeelt.
- Afspraken, klanten, betalingen ongewijzigd.
- Fout in één caller: alleen die sleutel intrekken.
- Herstel = gecorrigeerde code opnieuw testen en uitrollen. Nooit terug naar de huidige onbeveiligde functie.

## 5. Nog ontbrekend

- Toegepaste tabellen (alleen lokaal getest), secrets, ondertekenhelpers in callers.
- Echte event-resolver (queries staan in `eventVerifier.ts`), inclusief tijdzone-omrekening afspraakstart.
- Statusregels voor review/no-show-afspraken en automation-runs zijn minimaal (alleen `geannuleerd`/`skipped`); vaststellen.
- Gateway-zijde: STOP-schrijfpad en salonkoppeling; end-to-end niet bewezen.

## 6. Implementatieset eerste productiepatch (sprint, NIET uitgevoerd)

Guard (inactief, klaar): noodstop `sendingPaused` eerst (fout/onbekend = gepauzeerd, 503, geen claim); `whatsappEnabled` geldt ook voor test=true; demo = simulatie zonder provider; herinneringsvensters 24h (23h,25h] en 2h (1h,3h] (ruimste bestaande schedulertolerantie ±1h); automation-scheduler stuurt herinneringen als `kind: reminder` + `appointment:<id>:24h|2h`, zodat beide schedulers één claim delen. Salons met afwijkende `reminder_hours_before` worden geweigerd tot apart besluit.

Database minimaal: `whatsapp_send_claims`, `whatsapp_send_nonces`, `gateway_tenant_links`, `whatsapp_opt_outs` + RPC `whatsapp_is_opted_out`, receipts-tabel + atomische RPC uit 2026-10-09-voorstel, vlag `whatsapp_sending_paused` in `tenant_feature_flags` (default true).

Secrets: per caller signing key (6), contact-ref-sleutelring, Gateway HMAC v1-sleutel, claim/content-HMAC-sleutel.

Patchvolgorde: (1) SQL op staging, (2) secrets, (3) nieuwe whatsapp-send met noodstop AAN, (4) callers 6–16 ondertekenen + event_ref, (5) UI 1–5 action_id + klantkeuze, (6) Gateway STOP-route activeren, (7) demo ontgrendelen, (8) één echte salon na goedkeuring.
