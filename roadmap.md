# Roadmap

- [ ] Gerichte finale Viva-contractreview: POST-trustmodel en onafhankelijke merchant/order/amount/currency-binding controleren, API-eenheden en afronding officieel onderbouwen, alleen bewezen correcties met synthetische tests voorbereiden; geen deployment, charges of Beautycare-wijzigingen.
- [x] Bestaande ISV-betaalroutes aangesloten en zes functies veilig gedeployed; migraties 0022/0023 aanwezig, 64 gerichte tests en 18 geïsoleerde opslag/concurrentietests geslaagd. Vijfminutenjob actief; accountrefresh onafhankelijk van betaalgate, geen LIVE orders.
- [ ] LIVE charge-activatie wacht op sluitend Viva LIVE webhook/retrieve-contractbewijs, geverifieerde salon-KYC/acquiring en afzonderlijke activatie-GO; geen salonallowlist.
- [x] Account/KYC/acquiring-refresh onafhankelijk van betaalgate: viva-webhook en viva-payment-reconcile gedeployed, 39 gerichte tests en Deno-check geslaagd; worker direct uitgevoerd, één LIVE accountstatus opgeslagen, 0 betaalactivaties. Officiële LIVE signature/refund/retrieve-contractdetails blijven onvoldoende bewezen: directe officiële pagina's time-out, subagentclaim niet reproduceerbaar; niets ingeschakeld.

- [x] GlowPay-branding voorbereid; bestaande merchant-UNIQUE read-only geverifieerd, geen salonrijen gelezen.
- [ ] LIVE ISV-create koppelen: blokkerende server-only reservering/recovery vereist aparte schema-GO en LIVE-contractverificatie; schakelaar blijft uit.

- [x] Eén inactieve LIVE ISV-voorbereiding: eigen secretnamen, default-off configuratie, token/create/retrieve/status; 73 fictieve tests geslaagd, geen activatie of externe verzoeken. Activatie wacht op aparte GO, brandingkleur/logo en source-codevoorziening.

- [x] Laatste mobiele voorbeeldkopcorrectie: in previewmodus verbergen "Nu sluiten" en "Verder via Instellingen › Snelle setup" op smalle schermen (44px-X blijft), kop compact zodat "Stap 3 van 7" 12px onder de disclaimer staat; desktop en normale onboarding onveranderd; 25 tests geslaagd, stappen 1/3/7 fictief gecontroleerd op 390/1440 px; geen echte gegevens of publicatie.

- [x] Eén previewpolish: mobiele voorbeeldkop met disclaimer op eigen regel en vrije 44px-sluitknop; GlowPay-logo stap 3 15,4% kleiner; stap 7 en overige inhoud ongewijzigd; stappen 1/3/7 fictief gecontroleerd op 390/1440 px, sluitactie geslaagd, 25 relevante tests geslaagd; geen echte gegevens of publicatie.

- [x] Gerichte onboardingafwerking: boekingsstatus Ingesteld, duidelijke uitgeschakelde activatieknop en mobiele afronding; zeven stappen fictief gecontroleerd op 390/1440 px, 25 frontendtests geslaagd, niets gepubliceerd. GlowPay-logo ontbreekt, bestaand beeld ongewijzigd.

- [x] Gerichte desktop-agendadatumkiezer herstellen en alleen kalenderstijl verfijnen; 27 bestaande tests geslaagd en geïsoleerde browsercontrole op 1280/390 px voor openen, datumselectie en Vandaag, zonder echte gegevens of publicatie

- [x] Bundel mobiele no-showrisico's met ongewijzigde berekeningen en acties; beperkte previewcontrole op 390 px, niets publiceren

- [x] Ronde 3 mobiele afwerking: compacte actiekaarten, rustiger Autopilot en omzetcontext; uitsluitend geïsoleerde controle op 390 px, niets publiceren

- [x] Corrigeer mobiele datumselectie, verduidelijk medewerkerfilter en verminder bovenruimte; controleer uitsluitend synthetisch op 375/390 px

- [x] Gerichte mobiele agenda: datumkiezer, één medewerkerbediening en compactere kaarten
- [x] Controleer datum, medewerkerkeuze, afspraakvenster en sleepgreep op 375/390 px met synthetische gegevens, zonder opslaan of publiceren

- [x] Sprint 3: dagelijks menu eerst met behoud van rollen, routes en uitklapstaat
- [x] Sprint 3: snelle start via bestaande salonopslag en afronding, neutrale statusinformatie
- [x] Sprint 3: synthetische regressietests en lokale layoutcontrole, niets publiceren

- [x] Audit mobiele privacy- en consentkaarten en vergelijkbare dossiercontrols
- [x] Verduidelijk bestaande formulieraanpasbaarheid en bewerkactie
- [x] Verduidelijk bestaande behandelverslagconfiguratie indien aanwezig
- [x] Verifieer Beautycare op 390×844, Studio Nova-isolatie en typecheck
- [x] Vervang alle publieke faviconformaten door het officiële GlowSuite-icoon
- [x] Voeg GlowSuite-manifest en Apple touch icon toe
- [x] Verifieer publieke bereikbaarheid, browsericoon en typecheck
- [x] Stap-2 PGRST204 opgelost: settings-update stuurt alleen salon_name; logo/salontype blijven lokale wizardstate met eerlijke melding (2026-10-15, preview only)
