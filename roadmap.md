# Roadmap

- [x] Gerichte launch-readinessronde: ondersteunde schedulerbinding/pauze ontbreekt; job aantoonbaar actief zonder Authorization. Echte directe geautoriseerde POST 200, 0 betalingen verwerkt; productielog 21:32 UTC account_refresh scanned=1/synced=1/failed=0. Anonieme GET/POST 401, geautoriseerde GET 405. Intern geen duurzame subscription-evidence gevonden; exacte menselijke schedulerstappen en Viva-vragen voorbereid in LAUNCH-READINESS-2026-10-16.md. Geen deployment/registratie/charge/refund/UI-publicatie; LIVE-test alleen checklist, geen uitvoering. Periodieke job blijft extern geblokkeerd.
- [x] Gerichte partnercontractimplementatie: schriftelijk bevestigde LIVE merchant-scoped sale lookup met major units ingesteld; strikte parser behouden; 1797 hard geblokkeerd vóór lookup/write (refund_contract_unverified_hold); vijf ondersteunde webhookevents voorbereid en blinde GET/POST-registratie verwijderd (registration_evidence_required). Gedeployed: viva-webhook, verify-viva-payment, viva-payment-reconcile, register-viva-isv-live-webhooks. 153 gerichte tests en vier Deno-functiechecks geslaagd; volledige Viva-suite 406/407, één bestaande commentaarassertie buiten scope faalt. Geen orders, charges, refunds, Beautycare-wijzigingen, schedulerwijzigingen of UI-publicatie. Bron/handmatige vervolgstappen: PARTNER-CONFIRMATION-2026-10-16.md.
- [ ] Exact reversal Retrieve contract: Viva partner moet refundteken/eenheid, oorspronkelijke-ID-veld en successtatus bevestigen; 1797 blijft held, ook bij synthetische contractinjectie.
- [ ] Centrale subscriptions: Viva partner moet per LIVE account + vaste callback + event-ID bestaande/expliciet ontbrekende registraties schriftelijk bevestigen; geen betrouwbare interne evidence, geen providerregistratie uitgevoerd.
- [ ] Gerichte schedulerherstelrun geblokkeerd: beschikbare platformtools/CLI bieden geen ondersteunde credentialbinding of jobdeactivering; eigenaar moet viva-payment-reconcile-every-5min stoppen via More > Cloud > Jobs. Productie bewezen: anonieme GET/POST 401, geautoriseerde GET 405; geen geautoriseerde job-POST of periodieke KYC-refresh bewezen, geen deployment of schedulerwijziging uitgevoerd.
- [x] Reconcile-auth vóór serveracties gedeployed: dedicated secret, constante-tijdvergelijking, anonieme GET/POST 401, POST-only, holdergebonden lease; 121 tests, drie Deno-checks en 18 lokale storage/concurrencychecks geslaagd. Beperkte siblingcontrole uitgevoerd; vendorclaims zonder officiële bron afgewezen, subscriptions/contract ongewijzigd.
- [ ] Authenticated vijfminuten-KYC-flow: bestaande unmanaged HTTP-job blijft actief maar krijgt 401; ondersteunde migratie/tools en generated cron-auth ontbreken, handgeschreven HTTP-schedule-SQL verboden. Vereist platformondersteunde credentialbinding, geen onveilige fallback.
- [x] Veilige correctie-GO: parser contract-fail-closed (null contract), private orderrouting en herhaalbare holds hersteld; 109 synthetische regressies en drie Deno-functiechecks geslaagd; viva-webhook, verify-viva-payment en viva-payment-reconcile gedeployed; geen LIVE-activatie of Beautycare-acties. Providerlijst GET 405: subscriptions blijven onverifieerbaar.
- [x] Gerichte finale Viva-contractreview afgerond: POST is ongeauthenticeerde trigger met onafhankelijke OAuth-opvraag; exacte ISV API-route/eenheden/refundschema blijven onbewezen. Kleine parserpatch met tests uitsluitend voorbereid, 62 bestaande + 22 geïsoleerde tests geslaagd; 9 regressies bewezen tegen origineel; geen deployment, charges of Beautycare-wijzigingen.
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
