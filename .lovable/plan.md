# GlowSuite Klantdossier 1.0 — Architectuuraudit en bouwplan

Read-only audit. Er is niets gewijzigd: geen migratie, geen nieuwe tabellen, geen code.

## 1. Bestaande infrastructuur die we hergebruiken

- **Tenant-model**: elke rij draagt `user_id` (= salon-eigenaar). Isolatie loopt via `user_row_matches_active_mode(user_id, is_demo)` in het RLS-beleid van o.a. `customers`, `appointments`, `employees`. Er is geen aparte `salon_id`-kolom; `user_id` is de tenantsleutel.
- **Kern-entiteiten**: `customers` (incl. `notes`, `marketing_consent`, `privacy_consent`), `appointments` (incl. `booking_token`, `confirmation_status`, `employee_id`, `service_id`), `services` (incl. `rebook_interval_days`), `employees`, `settings`.
- **Publieke klantflow**: `appointment-confirm` toont het complete patroon — token in de URL, opzoeken op `booking_token`, rate limiting via `check_public_rate_limit` per token en per IP, geen klantaccount nodig. `public-booking`, `public-memberships`, `public-shop` volgen hetzelfde patroon.
- **Automatisering**: `whatsapp-reminder-scheduler` en `automation-scheduler` met `scheduler_locks`, `scheduler_cursors`, `reminder_dispatch_claims` + `claim_reminder_dispatch` (deduplicatie), retries 1/5/15 min en dead-letter in `whatsapp_logs`, canonieke verzender `_shared/sendAppointmentReminder.ts`, e-mailfallback via `send-white-label-email`, kanaalvoorkeuren in `customer_message_preferences`.
- **Rollen**: enum `app_role` (eigenaar, admin, manager, medewerker, financieel, receptie), helpers `has_role`, `has_any_role`, `can_manage_operations`, `can_view_finance`; frontend `src/lib/permissions.ts`, `useUserRole`, `RoleProtectedRoute`.
- **Audit**: `audit_logs` (actor, action, target_type, target_id, details jsonb), leesbaar voor eigenaar/manager.

## 2. Ontbrekende onderdelen

Er bestaat vandaag **niets** voor: formuliertemplates, vragen/velden, versiebeheer, verzonden formulieren, antwoorden, handtekeningen, behandelverslagen, klinische foto's, dossieralerts, dossierstatus of documentopslag per klant. Ook geen privébucket en geen signed-URL-helper.

## 3. Niet hergebruiken

- **`customers.notes` en `appointments.notes`** als dossier: vrije tekst zonder structuur, versie of audit. Blijft bestaan voor gewone notities.
- **Bestaande buckets** `salon-logos`, `employee-photos`, `email-assets`: alle drie publiek. Klinische foto's en documenten mogen daar nooit in.
- **`booking_token` hergebruiken als formuliertoken**: dat token bevestigt afspraken en verloopt anders; dossierlinks krijgen een eigen token met eigen levensduur, wel op exact hetzelfde patroon.

## 4. Aandachtspunt dat het ontwerp raakt (geverifieerd)

Teamleden worden aangemaakt als eigen auth-gebruiker en gekoppeld via `user_access.owner_user_id` (zie `create-user`), maar de RLS op de kerntabellen vergelijkt `auth.uid() = user_id`. Toegang tot dossiergegevens door medewerkers vereist dus eerst een server-side tenant-resolver (bijv. `current_tenant_id()` op basis van `user_access`). Dit is een fundamentbeslissing vóór stap 1 van de bouw.

## 5. Voorgesteld datamodel (voorstel, compact)

Alle tabellen: `user_id` (tenant), `is_demo`, `created_at`, `updated_at`, RLS via de bestaande mode-helper plus een rolcheck.

| Tabel | Doel | Kern |
|---|---|---|
| `form_templates` | Sjabloon (intake, vragenlijst, toestemming, contract, nazorg) | `kind`, `title`, `validity_months`, `require_signature`, `is_active`, `current_version` |
| `form_template_versions` | Immutabele versie met velddefinitie | `template_id`, `version`, `schema jsonb` (velden + conditionele logica), `published_at`; unique (template_id, version) |
| `service_form_requirements` | Koppeling behandeling ↔ template | `template_id`, `service_id` nullable (`null` = alle diensten), `is_blocking` |
| `form_requests` | Uitnodiging naar klant | `customer_id`, `appointment_id`, `template_version_id`, `token uuid` unique, `expires_at`, `status`, `sent_at`, `completed_at` |
| `form_submissions` | Ingevuld resultaat, immutabel | `request_id`, `template_version_id`, `answers jsonb`, `rendered_snapshot`, `submitted_at`, `signature jsonb`, `signer_name`, `signed_at`, `ip_hash` |
| `treatment_record_templates` | Verslagsjabloon per behandeling | `service_id` nullable, `schema jsonb`, `version` |
| `treatment_records` | Behandelverslag | `customer_id`, `appointment_id`, `employee_id`, `service_id`, `values jsonb`, `locked_at` |
| `clinical_media` | Foto's/documenten | `customer_id`, `appointment_id`, `category` (voor/na/controle/overig/document), `storage_path`, `caption`, `uploaded_by` |
| `customer_alerts` | Aandachtspunten | `customer_id`, `source` (formulier/medewerker), `label`, `review_status` (onbeoordeeld/beoordeeld/actie nodig) |

Indexen minimaal op `(user_id, customer_id)`, `(user_id, appointment_id)`, `token`, `(template_id, version)`.

Dossierstatus wordt **berekend**, niet opgeslagen: een RPC leidt per afspraak af welke templates vereist zijn, welke een geldige submission hebben (binnen `validity_months` en op de juiste versie) en welke ontbreken. Groen/oranje/rood volgt daaruit; GlowSuite trekt geen medische conclusies.

## 6. Publieke klantflow

Eigen edge function `customer-forms` op het patroon van `appointment-confirm`: rate limit per token en IP → token opzoeken en vervaldatum controleren → versie-schema en salonbranding teruggeven → antwoorden opslaan → bij ondertekening snapshot + handtekening vastleggen en het verzoek afsluiten. Mobiel eerst, stapindicator, autosave van concepten, nette melding bij verlopen link. Na afsluiten is de submission alleen-lezen.

## 7. Medewerkersflow

Agenda-afspraak toont dossierstatus → ontbrekende documenten met één klik (opnieuw) versturen via de bestaande verzendpijplijn → tijdens/na de behandeling verslag invullen → foto's uploaden → alles landt in het tabblad Dossier op het klantprofiel, met tijdlijn als hoofdweergave (opgebouwd uit bestaande events, geen duplicaten).

## 8. Security en storage

- Nieuwe **private** bucket `clinical-files`, pad `<user_id>/<customer_id>/<uuid>`, uitsluitend via kortlopende signed URLs vanuit een edge function die rol en tenant controleert. Uploadvalidatie op mime-type en maximale grootte.
- Publieke schrijfacties uitsluitend server-side met service role; nooit direct vanuit de browser op dossiertabellen.
- Financieel krijgt géén dossierrechten; medewerker alleen volgens saloninstelling; eigenaar/manager volledig.
- Submissions en getekende contracten zijn immutabel: geen UPDATE-policy, correcties zijn een nieuwe submission.
- Audit-events in het bestaande `audit_logs` (bekeken, verzonden, ingestuurd, ondertekend, gedownload, verwijderd) — zonder medische inhoud in de logregel.

## 9. Belangrijkste risico's

1. Tenant-resolver voor medewerkers ontbreekt — blokkeert rolgebaseerde dossiertoegang.
2. Gezondheidsgegevens vragen juridische review (bewaartermijn, verwijderen, verwerkersovereenkomst) voordat klinieken live gaan.
3. Publieke links: raden, hergebruik en delen — mitigatie via lange tokens, korte vervaltijd, eenmalige afronding en rate limiting.
4. Uitlekkende signed URLs — korte geldigheid, geen URLs in logs of berichten.
5. Kwaadaardige of te grote uploads.
6. Versiebeheer fout uitvoeren maakt historische contracten juridisch waardeloos.
7. Vrije tekst in verslagen en PDF-export: XSS/injectie bij rendering.
8. Extra automatiseringslast op de bestaande scheduler bij veel salons.
9. Verwijderde medewerker die nog toegang houdt.
10. Scope-explosie: het genoemde P0 is te groot voor één release.

## 10. Schaalbaarheid

50 salons: geen probleem met de huidige opzet. 500 salons: tijdlijn en dossierstatus moeten gepagineerd en geïndexeerd zijn; statusberekening cachen per afspraak. 5.000 salons: aparte batchverwerking voor dossierherinneringen (cursor zoals Auto Rebook), audit-logretentie en storage-lifecycle nodig.

## 11. Advies: BUILD, maar in kleinere stappen

Het voorgestelde P0 is te groot. Splitsing:

**P0a (echte eerste release, testbaar bij Beautycare)**: tenant-resolver + RLS-fundament, formuliertemplates met versies en basisveldtypes, koppeling aan behandeling, handmatig versturen, publieke mobiele invulflow, handtekening, resultaat zichtbaar in klantdossier, audit-basis.

**P0b**: behandelverslag met eigen sjabloon, privéfoto's, dossierstatus zichtbaar in agenda en afspraakdetail.

**P1**: automatisch versturen bij boeking, herinnering bij niet ingevulde intake, geldigheidsduur en opnieuw-vereist-logica, alerts met beoordelingsstatus, tijdlijn als hoofdweergave.

**P2**: conditionele logica-uitbreiding, PDF-export van het dossier, retentie- en anonimiseringsbeleid, AI-samenvatting zonder diagnose, multi-locatie.

## 12. Aanbevolen implementatievolgorde

1. Tenant-resolver en rolmodel voor dossiertoegang vaststellen.
2. Migratie templates + versies + koppeling aan diensten (met GRANTs en RLS).
3. Migratie verzoeken + submissions (immutabel) en tokenvelden.
4. Edge function `customer-forms` voor publieke toegang en insturen.
5. Beheer-UI voor formulieren binnen de bestaande instellingenstijl.
6. Publieke mobiele invulpagina met salonbranding.
7. Dossier-tabblad in het klantprofiel.
8. Privébucket + signed-URL-functie, daarna behandelverslag en foto's.
9. Dossierstatus in agenda en afspraakdetail.
10. Automatisch versturen en herinneringen via de bestaande scheduler.

Wachten op akkoord voordat er iets gebouwd wordt.
