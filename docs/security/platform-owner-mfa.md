# Platform-owner MFA: beperkingen en herstelprocedure

## Server-side bescherming tegen verwijderen van de laatste factor
Supabase Auth biedt geen ondersteunde instelling of hook om `mfa.unenroll` te blokkeren voor een specifiek account.
- Een gebruiker met een AAL2-sessie mag via de Auth API (`DELETE /factors/{id}`) elke eigen factor verwijderen, ook de laatste.
- De MFA Verification Hook en Password Verification Hook gaan over inlogpogingen, niet over unenroll.
- `auth.mfa_factors` aanpassen met triggers valt onder Auth-internals en is niet toegestaan.

Gevolg: de GlowSuite-UI verbergt "Verwijderen" voor de laatste factor van een platform-owner (en bij onbekende owner-status), maar dit is **geen** server-side garantie. Wie een geldige AAL2-sessie heeft, kan de API direct aanroepen.

Wat wel server-side blijft gelden: zonder verified factor haalt de owner geen AAL2, dus `platform_require_owner_aal2` weigert alle platformdata. Verwijderen leidt tot verlies van toegang, niet tot extra toegang.

Mitigatie: altijd minimaal twee verified authenticators (bijvoorbeeld telefoon + reserveapparaat of wachtwoordmanager).

## Beheeromgeving en bevoegdheden
- GlowSuite draait op **Lovable Cloud**. Er is geen zelfstandig Supabase-project met een eigen dashboard.
- De Supabase-beheerinloggegevens (service role key, databasewachtwoord) zijn in Lovable Cloud **niet rechtstreeks beschikbaar** voor projectgebruikers. Ze kunnen niet worden opgehaald en er bestaat geen ondersteunde zelfbedieningsroute waarmee de owner zelf MFA-factoren van een account verwijdert.
- Alleen toegang tot het Lovable-project (bewerkrechten) is **op zichzelf geen geldige autorisatie** voor een MFA-reset. Bewerkrechten geven technische mogelijkheden, maar vervangen de hieronder beschreven identiteitscontrole en expliciete goedkeuring niet.

## Herstelprocedure A: owner verliest toegang tot GlowSuite-MFA
Dit is een gecontroleerde beheerprocedure, geen selfservice en geen app-functie.

1. **Melding** via een vooraf bekend kanaal; geen herstel via e-mail of chat alleen.
2. **Onafhankelijke identiteitscontrole** door een tweede, vooraf aangewezen vertrouwenspersoon: bijvoorbeeld videogesprek met ID en een callback op het vooraf vastgelegde telefoonnummer.
3. **Expliciete goedkeuring van de geverifieerde accounteigenaar**: pas na deze controle geeft de eigenaar schriftelijk (of via het vooraf afgesproken kanaal) akkoord voor één benoemde herstelhandeling.
4. **Verificatie van de uitvoerder**: de persoon die de herstelstap uitvoert, wordt zelf geïdentificeerd en vastgelegd (naam, rol, moment).
5. **Afzonderlijke autorisatie per handeling**: de feitelijke beheerstap gebeurt pas na een aparte, expliciete toestemming voor die ene handeling. Een algemene GO dekt geen toekomstige of bredere acties.
6. **Nauw afgebakende, tijdelijke beheerhandeling**: uitsluitend de MFA-factoren van dit ene account verwijderen via de ondersteunde beheerroute. Geen nieuwe functies, geen publieke herstelroute, geen rechtenwijzigingen, geen tweede platform-owner.
7. **Sessies intrekken en wachtwoord resetten**: alle bestaande sessies van het account worden beëindigd en het wachtwoord wordt opnieuw ingesteld, zodat een eventueel meegelekte sessie of inlog geen toegang meer geeft.
8. **Opnieuw inschrijven**: de owner logt in, voegt direct twee verified authenticators toe en haalt opnieuw AAL2.
9. **Auditlogging**: datum, uitvoerder, controleur, gebruikte controlemethode, toestemming en reden worden vastgelegd in het beveiligingslogboek (audit_logs of extern incidentregister).
10. **Opruimen en verifiëren**: eventuele tijdelijk gebruikte herstelmiddelen of -toegang worden verwijderd en de verwijdering wordt geverifieerd (bijvoorbeeld dat een tijdelijke route niet meer bereikbaar is).

## Herstelprocedure B: verlies van toegang tot het Lovable-account
- Als het Lovable-account zelf ontoegankelijk is (wachtwoord, MFA of e-mail van Lovable), is **Lovable Support** de escalatieroute.
- Pas nadat het Lovable-account is hersteld, kan procedure A voor GlowSuite-MFA worden gevolgd.
- Er is geen gegarandeerd herstelresultaat: de uitkomst hangt af van de verificatie die Lovable Support kan uitvoeren. Ga daar niet van uit in de planning.
- Voorkom dat het Lovable-account en GlowSuite van hetzelfde ene apparaat of dezelfde ene authenticator afhangen.

## Checklist: herstelinstructies veilig buiten GlowSuite bewaren
- [ ] Bewaar een kopie van dit document op minimaal twee onafhankelijke plekken (bijvoorbeeld wachtwoordmanager-notitie en een offline versleutelde kopie).
- [ ] Leg vast wie de aangewezen vertrouwenspersoon is en via welk vooraf bekend kanaal melding en goedkeuring lopen.
- [ ] Leg het vooraf vastgelegde telefoonnummer voor de callback-controle vast en houd het actueel.
- [ ] Zorg dat minimaal twee verified authenticators actief zijn op gescheiden apparaten.
- [ ] Controleer periodiek (bijvoorbeeld elk kwartaal) dat de kopieën bereikbaar en actueel zijn.
- [ ] Bewaar nooit wachtwoorden, TOTP-secrets of herstelcodes in hetzelfde bestand als deze instructies.
