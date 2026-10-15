# Platform-owner MFA: beperkingen en herstelprocedure

## Server-side bescherming tegen verwijderen van de laatste factor
Supabase Auth biedt geen ondersteunde instelling of hook om `mfa.unenroll` te blokkeren voor een specifiek account.
- Een gebruiker met een AAL2-sessie mag via de Auth API (`DELETE /factors/{id}`) elke eigen factor verwijderen, ook de laatste.
- De MFA Verification Hook en Password Verification Hook gaan over inlogpogingen, niet over unenroll.
- `auth.mfa_factors` aanpassen met triggers valt onder Auth-internals en is niet toegestaan.

Gevolg: de GlowSuite-UI verbergt "Verwijderen" voor de laatste factor van een platform-owner (en bij onbekende owner-status), maar dit is **geen** server-side garantie. Wie een geldige AAL2-sessie heeft, kan de API direct aanroepen.

Wat wel server-side blijft gelden: zonder verified factor haalt de owner geen AAL2, dus `platform_require_owner_aal2` weigert alle platformdata. Verwijderen leidt tot verlies van toegang, niet tot extra toegang.

Mitigatie: altijd minimaal twee verified authenticators (bijvoorbeeld telefoon + reserveapparaat of wachtwoordmanager).

## Herstelprocedure (owner verliest alle authenticators)
1. **Melding** via een vooraf bekend kanaal; geen herstel via e-mail of chat alleen.
2. **Onafhankelijke identiteitscontrole** door een tweede, vooraf aangewezen vertrouwenspersoon: bijvoorbeeld videogesprek met ID en een callback op het vooraf vastgelegde telefoonnummer.
3. **Beperkte beheertoegang**: alleen een beheerder met toegang tot het Lovable Cloud-project voert de stap uit, nooit via een publieke route of app-functie.
4. **Factoren verwijderen** van uitsluitend dit account via de beheer-API (`auth.admin.mfa.deleteFactor`) of Cloud → Users.
5. **Sessies intrekken** (`auth.admin.signOut` met scope global) en wachtwoord resetten.
6. **Opnieuw instellen**: owner logt in, voegt direct twee authenticators toe en haalt AAL2.
7. **Vastleggen**: datum, uitvoerder, controleur, gebruikte controlemethode en reden in het beveiligingslogboek (bijv. een audit_logs-regel door de beheerder of extern incidentregister).

Er wordt geen tweede platform-owner aangemaakt en geen publieke herstelroute gebouwd.
