# Plan: kritische UX-productreview GlowSuite

## Doel en afbakening

Een read-only review van acht kernjourneys voor niet-technische saloneigenaren en medewerkers. Ik wijzig niets en gebruik geen echte accounts, salondata, productieverbindingen of live diensten. The Beautycare Clinic blijft volledig buiten beeld.

De bestaande UI-polisreview, de 21 regressietests en de technische werking van de recente importfix worden niet opnieuw algemeen beoordeeld. Ik controleer alleen waar deze onderdelen de gevraagde journeys direct raken.

## Aanpak

1. **Journeys uittekenen vanuit de broncode**
   - Onboarding en eerste waarde.
   - Dashboard en de vraag: wat moet ik vandaag doen?
   - Afspraak toevoegen, verplaatsen en betalen in de agenda.
   - Klant aanmaken, zoeken en dossier openen.
   - Medewerkers, wekelijkse beschikbaarheid en verlof.
   - Publiek boeken op telefoon, ook als bestaande klant.
   - No-showherinneringen en betaalmoment.
   - Importeren en herstellen na een fout.

2. **Overgangen en doodlopende paden controleren**
   - Relevante routes, pagina's, onderdelen, lokale state en gebruikersacties volgen.
   - Extra aandacht voor klantimport, klantzoeken, werktijden en publieke boeking.
   - Bevestigingslinkrisico in e-mail alleen benoemen waar de broncode dit aantoont. Actieve e-mail- en betaalfuncties blijven onaangeraakt.
   - Alleen wanneer statische broncode onvoldoende uitsluitsel geeft, een geïsoleerde lokale mock met synthetische gegevens gebruiken. Geen productie-netwerk.

3. **Alleen bevestigde bevindingen selecteren**
   - Iedere bevinding krijgt een exacte route of bestand met regelnummers en een reproduceerbare gebruikershandeling.
   - Per bevinding: huidige ervaring, gewenste eenvoudigere ervaring en minimale wijziging.
   - Classificatie op P0/P1/P2, gebruikersimpact, moeite S/M/L en vertrouwen: hard codebewijs of duidelijk gemarkeerde hypothese.
   - Functioneel risico en visuele afwerking worden apart benoemd.

4. **Compact eindrapport in Nederlands B1**
   - Maximaal 12 bevindingen, op prioriteit geordend.
   - Geen losse ideeën, nieuwe functies, redesign of punten zonder aantoonbaar gebruikersprobleem.
   - Drie kleine implementatiesprints. Sprint 1 bevat maximaal 2 tot 3 snelle verbeteringen met toetsbare acceptatiecriteria.
   - De sprints draaien eerder goedgekeurd werk niet terug en vragen geen nieuwe test- of ontwikkelsprint buiten de voorgestelde wijzigingen.
   - Na het rapport stop ik. Er wordt niets geïmplementeerd of gepubliceerd.

## Technische grenzen

- Alleen lezen in `src/pages`, `src/components` en direct relevante routing/state/helpers/tests.
- Geen databasequeries, backendacties, API-aanroepen, e-mails, WhatsApp, betalingen, migraties of publicatie.
- Geen echte salonaccounts of klantgegevens.
- Geen wijzigingen aan projectbestanden. Alleen het reviewrapport wordt in chat opgeleverd.