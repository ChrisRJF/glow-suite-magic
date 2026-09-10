# Klantdossier P2b-2: veilige privacyafhandeling

## Doel
Bouw één afgeschermde privacyflow voor export, archiveren, bewaarbelemmeringen, pseudonimiseren, gecontroleerd verwijderen en retentie. Bestaande dossier-, betaal- en communicatieprocessen blijven intact.

## Uitvoering
1. Voeg het datamodel toe voor privacyverzoeken, bewaarbelemmeringen, retentiebeleid en herhaalbare bestandsopruiming. Breid klanten uit met archief- en pseudonimiseringsstatus.
2. Dwing rechten en tenantisolatie in de database af. Alleen eigenaar en admin krijgen gevoelige privacyacties; manager krijgt export, archief en legal hold; definitief verwijderen blijft eigenaar-only.
3. Bouw één serverfunctie voor status, impact/preflight, privacy-export, archiveren/herstellen, legal hold, pseudonimiseren en verwijderen. Elke actie is idempotent en audit veilig.
4. Maak privacy-export als server-side ZIP met `persoonsgegevens.pdf`, `data.json` en alleen expliciet gekozen foto’s. Sla deze privé op en lever een kort geldige download.
5. Stop bij archief/pseudonimisering/verwijdering alle nieuwe klantautomatisering. Ondertekende snapshots en hashes worden bij pseudonimisering nooit gewijzigd.
6. Laat verwijderen alleen doorgaan zonder legal hold, open financiële verplichting of actief bewaarbeleid. De databaseactie is transactioneel; gekoppelde bestanden worden exact per geregistreerd pad opgeruimd en bij falen opnieuw geprobeerd.
7. Voeg in het klantdossier een ingetogen privacypaneel toe met impactoverzichten en exacte typebevestiging. Vervang de bestaande directe verwijderknop door deze veilige flow.
8. Voeg onder Instellingen `Privacy & bewaarbeleid` toe. Elk beleid start uitgeschakeld, vereist eerst een dry-run en moet daarna expliciet worden geactiveerd.
9. Voeg als laatste een dagelijkse, tenant-eerlijke retentieronde toe via de bestaande scheduler-infrastructuur, met cursor, batches, locks, legal-holdcontrole en policy-hercontrole.

## Veiligheid en testen
- Vooraf geverifieerd: directe klantverwijdering is onveilig door blokkerende financiële en operationele relaties; bestaande storagepaden zijn klantgescheiden; er bestaat nog geen retentiejob.
- Alle destructieve acceptatietests gebruiken uitsluitend één nieuwe, uniek herkenbare tijdelijke testklant en geïsoleerde records. Bestaande Studio Nova- en Beautycare-dossiers worden alleen read-only gecontroleerd.
- Test exportisolatie, rollen, cross-tenant blokkade, legal hold, financiële blockers, idempotentie, rollback, immutable documenten, exacte storage cleanup, dry-run zonder mutaties en veilige activering.
- Controleer daarna regressies voor P0a, P0b, P1, P2a, P2b-1, WhatsApp, No-show, Omzet Autopilot en GlowPay/Viva. Er worden geen echte berichten verstuurd.

## Technische keuzes
- Nieuwe structuur via één database-migratie met RLS, grants, indexes, permission-RPC’s en transactionele actie-RPC’s.
- Eén nieuwe `privacy-actions` functie voor gebruikersacties en export; één nieuwe `privacy-retention` functie voor de geplande ronde.
- Geen standaard bewaartermijnen: alle categorieën starten met `enabled=false`, `action=none`, zonder maanden.
- Geen automatische juridische beslissing: beleid wordt door de salon ingesteld; onduidelijke of geblokkeerde verwijdering stopt volledig zonder deelwijzigingen.
