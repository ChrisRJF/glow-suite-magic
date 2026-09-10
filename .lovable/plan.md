# Klantdossier P0a — bouwplan

Alleen P0a: formulier maken, publiceren als versie, koppelen aan behandeling, handmatig versturen, klant vult mobiel in en ondertekent, resultaat terug bij klant en afspraak. Geen automatische verzending, geen behandelverslagen, geen foto's, geen dossierstatus in de agenda, geen export, geen AI.

## Blocker die eerst opgelost wordt

Teamleden zijn eigen accounts, gekoppeld via `user_access.owner_user_id`, terwijl de huidige toegangsregels alleen `auth.uid() = user_id` vergelijken. Zonder centrale tenant-bepaling kan een medewerker geen dossier zien. Stap 1 is daarom een server-side resolver; bestaande toegangsregels van andere modules blijven ongemoeid.

## Stap 1 — Tenant- en rolfundament

Database-functies met vaste search_path, volledig gekwalificeerde tabelnamen, uitvoerrecht alleen voor ingelogde gebruikers, en nooit invoer uit de browser:
- `current_tenant_id()` — eigenaar krijgt het eigen account; een teamlid krijgt `owner_user_id` uit `user_access`, uitsluitend bij een actieve relatie; anders leeg.
- `can_view_dossier_status()` — eigenaar, admin, manager, medewerker, receptie.
- `can_view_dossier_content()` — eigenaar, admin, manager, medewerker. Niet receptie, niet financieel.
- `can_send_customer_form()` — eigenaar, admin, manager, medewerker, receptie.
- `can_manage_form_templates()` — eigenaar, admin, manager.

Financieel krijgt nergens toegang. Alle rechten worden in de database afgedwongen; de interface verbergt alleen wat toch al geblokkeerd is. Alleen de nieuwe tabellen gebruiken deze functies; bestaande tabellen blijven ongemoeid.

Status en inhoud worden gescheiden opgehaald, zodat receptie wel "intake ontvangen" of "toestemming ontbreekt" ziet, maar nooit antwoorden, contracttekst of handtekening.

## Stap 2 — Database (nieuwe tabellen)

`form_templates`, `form_template_versions`, `service_form_requirements`, `form_requests`, `form_submissions` — met `user_id` als tenant, `is_demo`, tijdstempels, GRANTs en toegangsregels op basis van stap 1.

Belangrijke keuzes:
- Gepubliceerde versies en afgeronde inzendingen krijgen geen wijzigingsrecht; een wijziging is altijd een nieuwe versie.
- `form_requests.token` is een lange willekeurige waarde met vervaldatum en status (concept, verzonden, geopend, afgerond, verlopen, geannuleerd).
- `form_submissions` bewaart antwoorden, de exacte getoonde tekst, ondertekenaarsnaam, moment, handtekening, inhouds-hash en beperkte audit-gegevens (IP versleuteld, niet leesbaar).

## Stap 3 — Publieke formulierfunctie (server)

Nieuwe edge function `customer-forms`, gebouwd op hetzelfde patroon als de bestaande afspraakbevestiging: snelheidslimiet per token en per IP, token opzoeken, vervaldatum en status controleren, alleen de strikt noodzakelijke gegevens teruggeven (salonnaam, logo, voornaam klant, formulier). Insturen wordt server-side gevalideerd op veldtypes, verplichte velden, toegestane keuzes en maximale lengte. Bij ondertekening wordt de definitieve tekst vastgelegd met hash; daarna is niets meer wijzigbaar. Dubbel insturen wordt geweigerd.

## Stap 4 — Formulierbeheer (salon)

Onder Instellingen komt "Formulieren": overzicht, nieuw formulier, veldtypes (korte tekst, lange tekst, ja/nee, aanvinkvakje, één keuze, meerdere keuzes, keuzelijst, datum, getal, informatietekst, akkoordvinkje, handtekening), per veld label, uitleg, verplicht en volgorde. Concept blijft bewerkbaar; "Publiceren" maakt v1, een latere wijziging wordt v2. Koppelen aan één of meer behandelingen.

Het opgeslagen formaat houdt ruimte voor latere voorwaardelijke vragen zonder oude formulieren te migreren.

## Stap 5 — Handmatig versturen

Actie "Formulier versturen" op het klantprofiel en op de afspraakdetails. Verzending loopt via de bestaande berichtinfrastructuur: WhatsApp wanneer de klant dat toestaat, anders e-mail. Geen SMS, geen nieuwe verzendmotor.

Dubbelklik-bescherming: bestaat er al een openstaand verzoek voor dezelfde klant en hetzelfde formulier, dan wordt dat verzoek opnieuw verstuurd in plaats van een nieuw aangemaakt. Is het al afgerond, dan volgt een expliciete bevestigingsvraag voordat een nieuw verzoek ontstaat.

## Stap 6 — Mobiele klantpagina

Nieuwe route `/formulier/:token`: salonlogo en -naam, korte uitleg, voortgang, grote velden, begrijpelijke foutmeldingen. Bij toestemming of contract eerst de volledige tekst, dan het akkoordvinkje en de handtekening, met knop "Ondertekenen en versturen". Bij gewone intake "Versturen". Afsluitend "Bedankt, alles is ontvangen." Verlopen of onbekende link toont een nette melding zonder gegevens.

## Stap 7 — Terug in GlowSuite

- Klantprofiel krijgt een tab "Dossier" met alleen "Formulieren en toestemmingen": naam, soort, status, verzonden, ingevuld, ondertekend, gekoppelde afspraak, versie, plus "Bekijken" (alleen-lezen weergave van antwoorden en definitieve tekst).
- Afspraakdetails krijgen een blok "Formulieren" met per gekoppeld formulier of het ingevuld is, plus versturen/opnieuw versturen en bekijken.

## Stap 8 — Audit, veiligheid en tests

Gebeurtenissen in het bestaande auditlogboek: aangemaakt, gepubliceerd, verzoek aangemaakt, verzonden, geopend, ingestuurd, ondertekend, bekeken. Zonder antwoorden, zonder handtekening, zonder token.

Alle door gebruikers ingevoerde tekst wordt als platte tekst weergegeven, nooit als opmaakcode.

Tests:
1. Onveranderlijkheid: v1 invullen en ondertekenen, daarna v2 publiceren; de oude inzending toont nog exact v1 en de hash klopt.
2. Scheiding tussen salons: salon A kan formulieren, verzoeken en inzendingen van B niet lezen of manipuleren.
3. Financieel kan geen formulierinhoud lezen.
4. Verlopen of onjuist token geeft geen gegevens prijs.

## Wat expliciet niet verandert

Twilio, Viva/GlowPay, de bestaande herinneringspijplijn, betalingslogica, agenda, no-show preventie en Omzet Autopilot blijven ongewijzigd. Na afloop volgt een regressiecontrole op inloggen, dashboard, agenda, nieuwe afspraak, klanten, no-show, WhatsApp-herinnering en de betaalpagina's.

## Bekende beperkingen van P0a

Geen automatische verzending bij boeking, geen geldigheidsduur of herinvulregels, geen alerts, geen tijdlijn, geen foto's of behandelverslagen, geen dossierstatus in de agenda, geen export.

## Technische details

- Nieuwe tabellen: `form_templates`, `form_template_versions`, `service_form_requirements`, `form_requests`, `form_submissions`.
- Nieuwe functies in de database: `current_tenant_id()`, `can_access_dossier()`.
- Nieuwe edge function: `customer-forms` (publiek, met snelheidslimiet via `check_public_rate_limit`).
- Nieuwe frontend: formulierbeheer onder Instellingen, `/formulier/:token`, dossier-tab, formulierblok bij de afspraak.
- Aan te passen bestaande bestanden: `src/App.tsx` (route), `src/pages/InstellingenPage.tsx` (beheer), `src/pages/CustomersPage.tsx` (tab), `src/pages/CalendarPage.tsx` (afspraakdetail), `src/lib/permissions.ts` (nieuwe rechten).
