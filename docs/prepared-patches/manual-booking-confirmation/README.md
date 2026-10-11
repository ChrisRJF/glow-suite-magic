# Bevestigingsmail bij handmatige afspraak (voorbereid, INACTIEF)

Niets toegepast, niets gedeployed, niets in `src/` gewijzigd.

## Bestanden
- `manualConfirmationCore.ts`: serverlogica met ingespoten afhankelijkheden (geen eigen reads/sends).
- `tests/atomic-appointment-move/manual-confirmation.test.ts`: mocks, fictieve salons.

## Werking
1. Agenda slaat op via `create_appointment_atomic` (Agenda 3.0 stap 3). Alleen bij `ok` volgt stap 2.
2. Browser roept een nieuwe Edge Function `manual-booking-confirmation` aan met alleen
   `{ appointment_id, send_to_customer }` en de eigen login. Geen user_id, e-mailadres of tekst.
3. Server: login controleren, salon en rol (eigenaar/admin/manager/receptie) uit `user_roles`,
   afspraak lezen gefilterd op id + salon + modus, compleet (klant, behandeling, start, eind),
   niet geannuleerd. Ontvanger = e-mail van de gekoppelde klant.
4. Niet sturen bij: geen e-mail, demo, afgemeld (`customer_message_preferences`), noodstop
   (`customer_email_controls`, fail closed), onduidelijke tijd (oude notatie, nooit gegokt).
5. Eenmalig: claim op `manual-booking-confirmation-<id>`; dubbel klikken = één mail.
   Mislukt verzenden geeft de claim vrij.
6. Verzenden via het bestaande sjabloon `booking_confirmation` en de bestaande
   send-white-label-email-route als service-aanroeper. Tijd in Europe/Amsterdam.
   'Mijn afspraak'-link alleen bij een geldige `booking_token`.
7. Betalingen worden niet gelezen of gewijzigd.

## UX-concept
In 'Nieuwe afspraak', onder de klant: één schakelaar **"Stuur bevestiging naar klant"**.
- Standaard AAN als de klant een e-mailadres heeft en niet is afgemeld; anders uit en
  grijs met uitleg "Geen e-mailadres bekend".
- Na opslaan: "Afspraak staat in de agenda · bevestiging verstuurd" of
  "· geen bevestiging verstuurd (reden)". Mislukte mail laat de afspraak staan.

## Openstaande voorwaarde
De huidige send-white-label-email accepteert `user_id` uit het verzoek. Voor activatie
moet de voorbereide `emailSendAuth.ts`-controle live staan, zodat alleen de server
(service-aanroeper) namens een salon kan verzenden.

## Activatie (elk apart goedkeuren)
1. Autorisatiepatch send-white-label-email live (emailSendAuth).
2. Claimopslag: unieke sleutel op verzendlog of aparte claimtabel (migratie, apart).
3. Edge Function `manual-booking-confirmation` deployen met deze kern.
4. Agenda 3.0 stap 3 actief voor de salon (create via RPC).
5. Frontend met schakelaar publiceren, eerst voor een demosalon (mail onderdrukt),
   daarna één testmail op een eigen adres, pas daarna Beautycare.
Terugval: schakelaar verbergen of functie uitzetten; afspraken blijven werken.

## Correctie 2026-10-11 (inactief)

- Gat A (verzonnen beheerlink): de ACTIEVE renderer in `send-white-label-email` maakt zonder `manage_url` nog steeds `https://<slug>.glowsuite.nl/afspraak/beheer`. Afgedekt door `bookingConfirmationManageAction.ts` (inactieve template-diff, alleen exacte `https://glowsuite.nl/mijn-afspraak/<uuid>` toegestaan, anders geen knop). De kern verstuurt niets zolang `rendererTokenOnlyManageLink !== true` (fail closed). VEREISTE voor activatie: deze diff eerst apart goedgekeurd deployen; een test faalt bewust zodra de actieve fallback verdwijnt, als signaal om de status bij te werken.
- Gat B (bron/status): alleen `source === "manual"`; allow-list status `gepland|bevestigd|confirmed|geboekt`; allow-list betaalstatus leeg/`unpaid`/`none`/`paid`. Online, public_booking, auto_rebook, geannuleerd/cancelled, no-show, pending_confirmation, open/pending/failed/expired holdings krijgen niets. Let op: de huidige actieve `handleAdd` zet geen `source`; pas na Agenda 3.0 stap 3 (`create_appointment_atomic` met `source: "manual"`) kan deze route mails sturen.
- Afzender: gelijk aan publieke bevestiging (`salon_slug` = `public_slug`, geen `sender_legacy_name_id`).
- Beperking: claim/idempotency is alleen met een in-memory mock getest. Dat is GEEN geteste database-idempotency. Unieke claimtabel, serverrechten, demo-mode-checks en de hele Agenda 3.0 stap 3 moeten afzonderlijk worden gebouwd, getest en geactiveerd.

## Uitbreiding 2026-10-11: verzendregistratie via outbox (INACTIEF)

- Keuze in het formulier: "Bevestigingsmail versturen" (`CalendarPage.tsx`), verborgen zolang
  `MANUAL_CONFIRMATION_UI_ENABLED = false` (`src/lib/agendaCreateClient.ts`). Daardoor blijft `send_confirmation` false.
- De keuze zit in de aanvraag zelf (en dus in de hash van `create_appointment_atomic_as`): opnieuw versturen houdt dezelfde keuze;
  een andere keuze met dezelfde aanvraag-ID = `request_mismatch`.
- `docs/proposed-migrations/2026-10-11_manual_confirmation_outbox.sql`: tabel `manual_confirmation_outbox` + trigger op
  `agenda_create_requests`. De verzendregistratie ontstaat in DEZELFDE transactie als de afspraak; replay maakt geen tweede rij.
  Bestaande functies blijven ongewijzigd. Claim/finish-functies alleen voor service_role.
- `manualConfirmationWorker.ts`: geplande serverworker; per rij `sendForTenant` (salon, klant, e-mail, toestemming, noodstop,
  demo, bron manual, status, renderer-check). Tijdelijke fout = later opnieuw met dezelfde idempotency key; rest definitief overgeslagen.
- Testfase: `allowedRecipients` = alleen expliciet toegestane testadressen; leeg = niemand.
- Lokale tests: `tests/atomic-appointment-move/run-local-pg-mail.sh` (wegwerpdatabase) en `manual-confirmation-worker.test.ts`.

### Nog nodig voor activatie (elk apart goedkeuren)
1. Rendererfix `send-white-label-email` (geen verzonnen beheerlink) + `emailSendAuth` live.
2. Migratie outbox toepassen.
3. Worker-Edge Function + schema (cron) plaatsen met testadreslijst als secret.
4. Eén testmail naar een toegestaan testadres bij Studio Nova; daarna pas `MANUAL_CONFIRMATION_UI_ENABLED = true` publiceren.
5. Beautycare alleen na Chris' toestemming.
