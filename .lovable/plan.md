# Klantdossier P2b — architectuuraudit en ontwerp (nog niets gebouwd)

## 1. Bestaande consent/data-infrastructuur
- `customers`: `marketing_consent boolean`, `privacy_consent boolean`, `whatsapp_opt_in`. Dit zijn platte vlaggen zonder datum, bron, bewijs of historie. Ongeschikt als bewijs van fototoestemming.
- `customer_message_preferences`: `email_opt_out`, `sms_opt_out`, `whatsapp_opt_out`, `retention_opt_out(+_at)`. Alleen communicatie, niet beeldgebruik.
- Geen enkele tabel heeft soft delete (`deleted_at`), anonimiseringsvelden, retentievelden of legal hold. Er bestaat geen anonymize/delete helper en geen klantverwijderactie in de app.
- Referenties naar `customers`: cascade bij `clinical_media`, `customer_alerts`, `form_requests`, `form_submissions`, `form_reissue_flags`, `treatment_records`, `document_exports`, `document_shares`, `auto_revenue_offers`. Blokkerend (no action) bij `appointments`, `payments`, `gift_cards`, `payment_links`, `checkout_items`, `rebook_actions`, `feedback_entries`, `waitlist_entries`, `whatsapp_inbound_messages`.
- Gevolg: een harde verwijdering is nu onmogelijk (financiele records blokkeren) en zou tegelijk stilzwijgend het volledige klinische dossier cascaderen. Verwijderen moet dus altijd via een server-flow, nooit via een directe delete.
- Aanwezig en herbruikbaar: tenant-resolutie, rolchecks, `audit_logs`, private buckets `clinical-files` en `dossier-exports`, hashed share tokens, PDF/ZIP-generatie, timeline-RPC, rate limiting.

## 2-6. Marketingtoestemming, scope, koppeling, intrekken, historie
- Nieuwe tabel `customer_consents` als **append-only event log**: `id, user_id, is_demo, customer_id, consent_type, scope, event ('granted'|'withdrawn'), occurred_at, source ('salon'|'form'|'booking'), source_reference, version, proof_reference (verwijzing naar ondertekende submission), actor_id, note`. Nooit overschrijven; huidige status is de laatste gebeurtenis per (klant, type, scope).
- Statuslogica afgeleid: `not_given` (geen event), `granted`, `withdrawn`. `expired` alleen afgeleid uit een optionele geldigheidsduur, niet als opgeslagen status.
- Scope-advies: houd het klein. Twee scopes in P2b: `marketing_general` (website, social, portfolio) en optioneel `advertising` als aparte, expliciet aan te vinken scope. Kanaal-per-kanaal is voor salons onwerkbaar en levert schijnprecisie.
- Media-koppeling: variant C, maar praktisch: algemene toestemming van de klant bepaalt of marketing mogelijk is, en per foto komt een expliciete vlag `marketing_approved` op `clinical_media`. Een foto is alleen marketing-safe als beide waar zijn. Geen automatische publicatie, geen bulk-vinkje.
- Intrekken: nieuw `withdrawn` event, blokkeert direct alle toekomstige marketingweergave en zet elke `marketing_approved` foto terug naar niet-goedgekeurd. De klinische foto blijft in het dossier staan; intrekken van marketingtoestemming is geen verwijderverzoek.

## 7-8. Retentie en legal hold
- Configuratie per salon, geen door ons verzonnen termijnen: `retention_policies (user_id, category, retention_months nullable, delete_action ('none'|'anonymize'|'delete'), enabled)`. Categorieen: klantprofiel, afspraken, formulieren, ondertekende toestemmingen, behandelverslagen, klinische foto's, marketingtoestemming, auditlogs, gegenereerde exports, deellinks.
- Standaard staat alles op `none`, dus er verdwijnt niets zolang de salon geen beleid kiest.
- Berekende `retention_until` per record wordt niet opgeslagen maar in de job berekend, behalve voor `document_exports` (heeft al `expires_at`).
- `legal_holds (user_id, customer_id, reason, created_by, created_at, released_by, released_at)`. Actieve hold blokkeert elke automatische en handmatige verwijdering of anonimisering, met zichtbare melding in het dossier. Geen stille permanente hold: hold blijft zichtbaar en opheffbaar.

## 9-12. Verwijderen, anonimiseren, vrije tekst, foto's
Drie duidelijk gescheiden acties, alle server-side:
1. **Archiveren** (`customers.archived_at`): uit actief gebruik, data blijft volledig intact. Omkeerbaar.
2. **Anonimiseren**: `name` naar "Verwijderde klant", `email`, `phone`, `notes`, `preferred_language` leeg; operationele records blijven met dezelfde `customer_id` als pseudoniem. Onomkeerbaar.
3. **Verwijderen indien toegestaan**: alleen als er geen legal hold, geen openstaande betaling/cadeaubon en geen bewaarplichtcategorie is; anders wordt de actie geweigerd met uitleg in plaats van half uitgevoerd.
- Problematische velden: vrije tekst in `customers.notes`, `treatment_records` (verslagvelden), antwoorden in `form_submissions`, `clinical_media.caption`, `customer_alerts.label`, en berichtlogs met telefoonnummer. Deze kunnen namen bevatten en worden bij anonimisering niet automatisch schoongepoetst.
- Daarom eerlijke terminologie in de UI: dit is **pseudonimisering** van het klantprofiel, geen volledige anonimisering. Alleen bij "verwijderen" verdwijnt de inhoud echt.
- Foto's: actief dossier ongewijzigd; bij intrekken marketingtoestemming alleen marketinggebruik blokkeren; bij anonimisering blijven foto's staan (ze zijn herleidbaar, dus dit moet expliciet in de bevestiging staan) tenzij de salon kiest voor foto's verwijderen; bij verwijderen worden bestanden uit `clinical-files` gewist; bij legal hold gebeurt niets.

## 13. Immutable ondertekende documenten
- `form_submissions` bevat een snapshot plus hash. Persoonsgegevens daaruit weghalen breekt de hash en daarmee het bewijs.
- Advies: nooit stil bewerken. Twee toegestane uitkomsten per submission: **behouden** (met vastgelegde grondslag, standaard bij ondertekende toestemmingen) of **volledig verwijderen** inclusief snapshot, hash en afgeleide exports. Een derde optie "hash herberekenen" wordt afgeraden, want dan is geen enkel ondertekend document nog te vertrouwen.

## 14-15. Privacy-export en workflow
- Aparte flow "Persoonsgegevens exporteren", losstaand van de dossierexport: ZIP met `persoonsgegevens.pdf` (leesbaar), `data.json` (machineleesbaar) en optioneel `fotos/`. Bronnen: klantprofiel, afspraken, formulieren en antwoorden, handtekeningmomenten, behandelverslagen, foto-metadata, aandachtspunten, communicatielogs voor deze klant, toestemmingshistorie, deellinks en relevante auditgebeurtenissen. Nooit andere klanten, tokens, signed URLs of interne secrets.
- Adminworkflow: klant kiezen, "Privacyverzoek", type kiezen, **impactoverzicht** (aantallen per categorie plus wat blijft staan en waarom), bevestigen met typen van `VERWIJDEREN` of `ANONIMISEREN`, server voert uit, auditgebeurtenis volgt. Voor destructieve acties wordt eerst een privacy-export aangeboden, niet verplicht.
- `privacy_requests` tabel is wel gewenst (status, type, aangevraagd, afgerond, behandeld door, resultaat), omdat een verzoek meerdere stappen en herhaalbaarheid kent. `audit_logs` alleen is te dun voor statusopvolging.

## 16-21. Rechten, uitvoering, transacties, opruimen, audit, schaal
- Rechten: eigenaar alles; admin alles behalve definitief verwijderen tenzij expliciet recht; manager alleen privacy-export en toestemmingsbeheer; medewerker, receptie en financieel geen privacybeheer en geen inzage in het privacypaneel.
- Alle acties in een `privacy-actions` Edge Function met service role; per stap idempotent via `privacy_requests.id`; database-werk in RPC's zodat een gedeeltelijk geanonimiseerd dossier niet kan ontstaan; storage-opruiming pas na een geslaagde databasetransactie, en mislukte bestandsverwijderingen belanden in een herhaalbare opruimstap.
- Opruimen bij verwijdering: `clinical-files` bestanden, `dossier-exports` bestanden, alle deellinks intrekken, wachtrijen en herinneringen voor deze klant stoppen.
- Auditgebeurtenissen exact zoals gevraagd, altijd zonder inhoud, namen, tokens of URL's.
- Schaal: 50 salons met directe serverflows; 500 met een dagelijkse retentie-job per categorie in batches; 5.000 met tenant-eerlijke rondes, cursorpaginering en storage-lifecycle. Geen extern wachtrijplatform nodig.

## 22. Juridische beslissing nodig (niet door GlowSuite)
Bewaartermijnen per categorie, grondslag voor het behouden van ondertekende toestemmingen na een verwijderverzoek, welke financiele en medische gegevens niet gewist mogen worden, uitzonderingen op het recht op verwijdering, en of pseudonimisering volstaat. GlowSuite levert de knoppen, de salon of haar jurist vult het beleid.

## 23. Top-risico's
1. Cascade-verwijdering wist stil klinische dossiers. 2. Blokkerende financiele referenties maken verwijderen onmogelijk zonder duidelijke uitleg. 3. Hash-breuk bij bewerken van ondertekende documenten. 4. Schijn-anonimisering door vrije tekst en foto's. 5. Half uitgevoerde verwijdering. 6. Wees-bestanden in private opslag. 7. Actieve deellink na verwijdering. 8. Toestemming ingetrokken terwijl een export loopt. 9. Retentie-job die te veel wist bij verkeerde configuratie. 10. Te ruime rechten op privacyacties.

## 24. Scopevoorstel
- **P2b-1**: toestemmingsmodel met historie, intrekken, `marketing_approved` per foto, dossierpaneel "Toestemmingen", audit en rechten.
- **P2b-2**: privacy-export, archiveren/anonimiseren/verwijderen, `privacy_requests`, legal hold, retentieconfiguratie plus job, storage-opruiming.
- Advies: deze splitsing klopt, maar legal hold hoort al in P2b-2 vóór de retentie-job live gaat.

## 25. Advies
**BUILD**, in volgorde: P2b-1 eerst (klein, laag risico, direct zichtbare waarde), daarna P2b-2 in de volgorde privacy-export, archiveren, legal hold, anonimiseren, verwijderen, retentieconfiguratie, en pas als laatste de automatische retentie-job.

Nog niets gebouwd. Wachtend op akkoord.
