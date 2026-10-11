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
