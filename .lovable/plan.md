# Klantdossier P2b-2: veilige privacyafhandeling

## Doel
Bouw één afgeschermde privacyflow voor export, archiveren, bewaarbelemmeringen, pseudonimiseren, gecontroleerd verwijderen en retentie. Bestaande dossier-, betaal- en communicatieprocessen blijven intact.

## Uitvoering
1. Voeg het datamodel toe voor privacyverzoeken, bewaarbelemmeringen, retentiebeleid en herhaalbare bestandsopruiming. Breid klanten uit met archief- en pseudonimiseringsstatus. Privacyverzoeken bewaren na verwijdering alleen een interne referentie zonder klant-FK of persoonsgegevens.
2. Dwing rechten en tenantisolatie in de database af. Eigenaar krijgt alle acties. Admin krijgt export, archief, legal hold, pseudonimiseren en retentie; verwijderen alleen met een expliciet apart recht. Manager krijgt export, archief en legal hold, maar geen pseudonimisering, verwijdering of activering van destructief beleid. Overige rollen krijgen geen privacybeheer.
3. Bouw één serverfunctie voor status, impact/preflight, privacy-export, archiveren/herstellen, legal hold, pseudonimiseren en verwijderen. Elke actie is idempotent en audit veilig.
4. Maak privacy-export als consistente server-side momentopname: leg eerst de geselecteerde record-ID’s vast, controleer tenantownership opnieuw en bouw daarna een UTF-8 ZIP met versieerbare `data.json`, `persoonsgegevens.pdf` en alleen expliciet gekozen foto’s. Geen auth-ID’s, opslagpaden, tokens, URL’s of secrets. Sla privé op en lever een kort geldige download.
5. Stop bij archief/pseudonimisering/verwijdering alle nieuwe klantcommunicatie en automatisering. Ondertekende snapshots en hashes worden bij pseudonimisering nooit gewijzigd. De UI noemt dit nooit volledige anonimisering.
6. Laat verwijderen alleen doorgaan na een preflight én een tweede controle binnen de transactionele actie. Concrete blockers zijn actieve legal hold, open/pending/processing betaling, actieve financiële verplichting en een actief bewaarbeleid voor relevante documenten. Afgeronde historische betaling blokkeert niet op zichzelf. Het klantrecord verdwijnt pas als laatste en cascades zijn niet de businessflow.
7. Bewaar privacy-audit en privacy_requests na klantverwijdering zonder naam, contactgegevens of medische inhoud. Legal-holdredenen zijn korte platte tekst, alleen zichtbaar voor privacybeheerders en worden nooit in auditdetails gekopieerd.
8. Laat bestandsopruiming uitsluitend werken met vooraf geregistreerde exacte paden. Houd de aanvraag op `storage_cleanup_pending` of een veilige foutstatus tot alle bestanden weg zijn; herhaal mislukte opruiming idempotent.
9. Voeg in het klantdossier een ingetogen privacypaneel toe met impactoverzichten en exacte typebevestiging. Vervang de bestaande directe verwijderknop door deze veilige flow.
10. Voeg onder Instellingen `Privacy & bewaarbeleid` toe. Elk beleid start uitgeschakeld. Concept, dry-run, impactbevestiging en activering zijn aparte stappen. Elke wijziging zet het beleid terug naar beoordeling.
11. Voeg als laatste een dagelijkse, tenant-eerlijke retentieronde toe via de bestaande scheduler-infrastructuur, met UTC-cutoff, cursor, batches, locks, legal-hold- en policy-hercontrole en een server-side kill switch. Zonder actief beleid verandert de job niets.

## Veiligheid en testen
- Vooraf geverifieerd: directe klantverwijdering is onveilig door blokkerende financiële en operationele relaties; bestaande storagepaden zijn klantgescheiden; er bestaat nog geen retentiejob.
- Alle destructieve acceptatietests gebruiken uitsluitend één nieuwe, uniek herkenbare tijdelijke testklant en geïsoleerde records. Bestaande Studio Nova- en Beautycare-dossiers worden alleen read-only gecontroleerd.
- Test exportisolatie en momentopname, rollen, cross-tenant blokkade, legal hold, financiële blockers, idempotentie, rollback, immutable documenten, exacte storage cleanup/retry, blijvende privacyhistorie en audit, dry-run met nul mutaties, herbeoordeling en kill switch.
- Controleer daarna regressies voor P0a, P0b, P1, P2a, P2b-1, WhatsApp, No-show, Omzet Autopilot en GlowPay/Viva. Er worden geen echte berichten verstuurd.

## Technische keuzes
- Nieuwe structuur via één database-migratie met RLS, grants, indexes, permission-RPC’s en transactionele actie-RPC’s.
- Eén nieuwe `privacy-actions` functie voor gebruikersacties en export; één nieuwe `privacy-retention` functie voor de geplande ronde.
- Geen standaard bewaartermijnen: alle categorieën starten met `enabled=false`, `action=none`, zonder maanden.
- Geen automatische juridische beslissing: beleid wordt door de salon ingesteld; onduidelijke of geblokkeerde verwijdering stopt volledig zonder deelwijzigingen.
