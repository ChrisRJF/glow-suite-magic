# Klantdossier P3: kliniekworkflow

## Doel
Bouw één compacte workflow van afspraak naar dossiercheck, behandeling, nazorg en controle, plus een veilig afspraakgebonden klantportaal zonder klantaccount.

## Uitvoering
1. Breid het bestaande dossiermodel minimaal uit met behandeltrajecten, sessiekoppelingen en nazorgtekst per behandeling. Gebruik tenantgebonden rechten, bestaande auditfuncties en bestaande afspraken, formulieren, verslagen en media.
2. Voeg een afspraakgebonden, gehashte portaaltoegang toe via de bestaande publieke tokenstijl. Het portaal toont uitsluitend gegevens, acties en gedeelde documenten van die ene afspraak en hergebruikt bestaande bevestigings-, annulerings-, formulier- en documentstromen.
3. Toon in het portaal een begrijpelijke checklist voor vóór en na de behandeling, zonder technische of medische termen.
4. Maak bovenaan het afspraakdetail één dossiercheck met intake, toestemming, aandachtspunt, foto’s en verslag. De knop `Volgende actie` opent de eerste ontbrekende relevante stap.
5. Voeg in het klantdossier een compact trajectoverzicht toe met chronologische sessies, gekoppelde formulieren, verslagen, foto’s, nazorg en volgende afspraak.
6. Laat `Controle-afspraak plannen` de bestaande agenda-aanmaak hergebruiken en de nieuwe afspraak aan hetzelfde traject koppelen.
7. Laat salons eigen nazorgtekst per behandeling beheren. Handmatig delen gebruikt alleen de bestaande communicatie-infrastructuur en wordt tijdens implementatie niet echt verstuurd.

## Veiligheid en controle
- Reception ziet alleen administratieve status; financieel geen dossierinhoud; overige rollen volgen de bestaande dossierrechten.
- Publieke toegang controleert tokenhash, afspraakgrens, tenant, verloop en intrekking. Geen volledig dossier of andere afspraken.
- Nieuwe tabellen krijgen expliciete grants, RLS, tenantisolatie en indexes.
- Controleer P0-P2, agenda, formulieren, dossier, WhatsApp, documentdelen en GlowPay/Viva. Verstuur geen echte berichten.
- Rond af met gerichte tests, typecheck en de gevraagde P3-matrix. Start geen P4.
