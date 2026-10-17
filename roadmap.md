# Roadmap

- [x] Focused WhatsApp scheduler follow-up: credential-free read confirmed job 4 active, 15-minute pg_net POST with Bearer; identity remains unknown. No managed schedule tools/generated cron verifier available in this session. Isolated README now specifies support/Cloud Jobs action, pre-side-effect auth, manual/internal gates and pause-first rollback. 61 local tests passed (27 prepared security + 34 inactive HTTP); no active function edits, credential retrieval, DB writes, cron changes or messages.
- [x] WhatsApp security preparation: isolated auth/tenant/retry candidates and migration plan in docs/prepared-patches/whatsapp-security; 45 focused tests passed. Active functions untouched because edits auto-deploy. Broader inactive-security suite: 53 passed, one existing Viva import-policy failure left out of scope. No live actions.
- [ ] WhatsApp scheduler activation: blocked on proven current managed authentication/binding and separate configuration/deployment GO; prepared scheduler must not be activated as-is.

- [x] Kleine herstelronde: NoShowCenter telt isHigh; AutoRevenueMetrics verduidelijkt creation-cohort/statusconversie, ontbrekende cohort geeft geen percentage; btw-aanname/refunds-labels verduidelijkt; Autopilot UI noemt schattingen. 79 gerichte tests geslaagd; formules, financiële logica, backend en productie ongewijzigd; geen deployment/publicatie. Netto-omzet niet opnieuw gedefinieerd zonder aparte GO.

- [x] Trial banner: navigation-only GlowPay CTA; 28 tests and fictitious mobile/desktop rendering checked. Real TEST-account screenshot unavailable; no deployment/publication or real-account login.

- [x] Minimale vijf-eventregistratie: eigenaar-aangeleverd officieel POST {url,eventTypeId}/204-contract toegepast; admin+AAL2+nieuw expliciet vijf-eventwoord behouden, actuele callback-keyvergelijking vóór POST, overige HTTP-statussen failed en netwerkuitkomsten unknown zonder retries. Alleen register-viva-isv-live-webhooks gedeployed (index.ts + helper); pagina/test/AGENTS alleen code. 21 tests en Deno-check geslaagd, preview build OK; productie anonieme POST 401 en GET callback 200 met key (niet getoond). Geen registratie/MFA-klikflow uitgevoerd of UI gepubliceerd; docs onafhankelijk ophalen mislukte, geen duplicate-errorsemantiek verzonnen.
- [x] Gerichte launch-readinessronde: ondersteunde schedulerbinding/pauze ontbreekt; job aantoonbaar actief zonder Authorization. Echte directe geautoriseerde POST 200, 0 betalingen verwerkt; productielog 21:32 UTC account_refresh scanned=1/synced=1/failed=0. Anonieme GET/POST 401, geautoriseerde GET 405. Intern geen duurzame subscription-evidence gevonden; exacte menselijke schedulerstappen en Viva-vragen voorbereid in LAUNCH-READINESS-2026-10-16.md. Geen deployment/registratie/charge/refund/UI-publicatie; LIVE-test alleen checklist, geen uitvoering. Periodieke job blijft extern geblokkeerd.
- [x] Gerichte partnercontractimplementatie: schriftelijk bevestigde LIVE merchant-scoped sale lookup met major units ingesteld; strikte parser behouden; 1797 hard geblokkeerd vóór lookup/write (refund_contract_unverified_hold); vijf ondersteunde webhookevents voorbereid en blinde GET/POST-registratie verwijderd (registration_evidence_required). Gedeployed: viva-webhook, verify-viva-payment, viva-payment-reconcile, register-viva-isv-live-webhooks. 153 gerichte tests en vier Deno-functiechecks geslaagd; volledige Viva-suite 406/407, één bestaande commentaarassertie buiten scope faalt. Geen orders, charges, refunds, Beautycare-wijzigingen, schedulerwijzigingen of UI-publicatie. Bron/handmatige vervolgstappen: PARTNER-CONFIRMATION-2026-10-16.md.
- [ ] Exact reversal Retrieve contract: Viva partner moet refundteken/eenheid, oorspronkelijke-ID-veld en successtatus bevestigen; 1797 blijft held, ook bij synthetische contractinjectie.
- [ ] Centrale subscriptions: eigenaar moet UI-publicatie apart toestaan en met admin+AAL2 expliciet klikken; alleen 204 bewijst succes, overige uitkomsten vereisen Viva-bevestiging per event. In deze ronde geen providerregistratie uitgevoerd.
- [x] Scheduler hersteld in eerdere Vault-ronde: oude job Disabled, viva-payment-reconcile-vault-5min actief; geplande run 22:00 UTC HTTP 200 en account_refresh scanned=1/synced=1/failed=0. Deze registratieronde wijzigde niets aan scheduler of auth.
- [x] Reconcile-auth vóór serveracties gedeployed: dedicated secret, constante-tijdvergelijking, anonieme GET/POST 401, POST-only, holdergebonden lease; 121 tests, drie Deno-checks en 18 lokale storage/concurrencychecks geslaagd. Beperkte siblingcontrole uitgevoerd; vendorclaims zonder officiële bron afgewezen, subscriptions/contract ongewijzigd.
- [x] Authenticated vijfminuten-KYC-flow hersteld via één server-only Vault-secret, zie schedulerregel; geen onveilige fallback.
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
