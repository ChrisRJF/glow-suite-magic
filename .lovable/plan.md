
# Onboarding UX Optimalisatie (geen redesign)

Doel: `src/components/OnboardingWizard.tsx` herstructureren van de huidige 5 stappen (Salon, Diensten, Team, Online, Betalen) naar een rustige 7-staps flow die aanvoelt alsof GlowSuite alles zelf regelt. Alle bestaande componenten (Dialog, Progress, Button, Input, Label, Card-stijlen, iconen, kleuren, spacing) blijven identiek. Alleen volgorde, copy, defaults en micro-interacties veranderen.

## Nieuwe stappen (7)

1. **Welkom** — bestaande layout, drastisch kortere copy, checklist met ✅ Agenda / Online betalingen / Pinautomaat / Slimme automatiseringen. CTA: "Start installatie".
2. **Salon** — eerst salontype-keuze (Kapper, Barbershop, Nagelstudio, Beautysalon, Kliniek, Overig) via bestaande card-stijl (grid met icon+label, hergebruik pattern uit huidige feature-grid op WelcomeScreen). Na keuze subtiele confirmatie-regel. Daarna salonnaam-input en optionele logo-upload (bestaand). Telefoon/adres verplaatsen naar "later in instellingen" (verwijderen uit wizard om cognitieve last te verlagen).
3. **GlowPay** — informatief scherm, geen configuratie. Toont ondersteunde methoden (iDEAL, Bancontact, Creditcard, Apple Pay, Google Pay) via bestaande PaymentMethodLogo-componenten. Bij demo modus (via `useDemoMode`) toont demo-notice.
4. **Terminal** — statusscherm met bestaande TerminalsCard-lookup. Bij geen terminal: geruststellende copy + secundaire actie "Bekijk ondersteunde terminals" (link naar `/instellingen`).
5. **Testbetaling / Systeemcheck** — vervangen door automatische health-check die parallel roept: `viva-status`, `viva-smart-checkout-health-check`, en simpele DB-ping (huidige supabase.auth check). Toont 4 rijen met spinner→check: Viva verbinding / Online betalingen / Database / Webhook. Geen echte betaling meer nodig (Viva credentials valideren via bestaande health-check function).
6. **Automatiseringen** — bestaande switches (huidige stap ontbreekt; nieuwe simpele lijst met 3 toggles: afspraakherinneringen, no-show preventie, review-verzoeken) allemaal AAN by default, met copy "Deze instellingen zijn aanbevolen en kunnen later altijd worden aangepast." Slaat op in `settings` tabel via bestaande fields (of no-op als velden ontbreken — check tijdens implementatie).
7. **Voltooid** — bestaande DoneScreen, emotionelere copy met 🎉, checklist ✅ Agenda / Klanten / Online betalingen / Automatiseringen / Dashboard. Primary CTA "Ga naar Dashboard", secondary "Bekijk eerste stappen" (→ `/support` of guided tour trigger).

## Verwijderd uit huidige wizard

- **Diensten-stap** (stap 1 nu): verwijderen. Salontype bepaalt straks default services die automatisch geseed worden via nieuwe helper `seedDefaultServicesForType(type)` — hergebruikt patroon van `DEMO_SERVICES`. Gebruiker hoeft niets in te vullen ("GlowSuite configureert automatisch").
- **Team-stap** (stap 2 nu): verwijderen uit onboarding — verplaatsen naar "later" (link in Voltooid-scherm). Eigenaar wordt automatisch als enige medewerker aangemaakt.
- **Online-stap** met copy booking link: opgaat in Voltooid-scherm (link blijft daar aanwezig zoals nu).

## Progress-indicator

Kop toont: `Stap X van 7 · nog ongeveer N minuten` (schatting: 3 min totaal, ~25 sec per resterende stap). Percentage-cijfer blijft, alleen extra tijdsindicatie toegevoegd.

## "Later afmaken"

Blijft. Onder de knop nieuwe micro-copy toevoegen (in dialog header of tooltip): "Je voortgang wordt automatisch opgeslagen."

## Copywriting

Nederlands, kort, kalm. Zonder em-dashes (project-regel). Herhalend gebruik van "GlowSuite configureert automatisch…" op stappen 2, 3, 4 en 7 voor consistente AI-feeling.

## Technische details

- Bestand: alleen `src/components/OnboardingWizard.tsx` bewerken.
- Nieuwe types: `SalonType = "kapper" | "barbershop" | "nagelstudio" | "beautysalon" | "kliniek" | "overig"` in `Progress.salon`.
- `totalSteps = 7`, `STEPS`-array uitbreiden met nieuwe id/label/icon per stap (hergebruik lucide iconen die al geïmporteerd zijn: Store, Sparkles, CreditCard, Zap/Rocket, Check, PartyPopper; toevoegen: ShieldCheck voor health-check).
- Health-check-stap: `Promise.allSettled` op edge functions; per rij UI-state `idle | checking | ok | fail`. Failing rows tonen "Later opnieuw proberen" maar blokkeren niet.
- Default automations opslaan in `settings` (velden: `auto_reminders_enabled`, `auto_noshow_enabled`, `auto_review_enabled` — checken of ze bestaan; anders localStorage-fallback tijdens implementatie).
- Salontype opslaan in `settings.salon_type` (best-effort update; niet blokkerend als kolom niet bestaat).
- Auto-seed services: nieuwe const `SERVICES_BY_TYPE` mapping, wordt na stap 2 op achtergrond geïnsert via bestaande `servicesCrud.insert`. Fout tolerant (geen toast bij falen).
- Bestaande `localStorage`-progress-sleutel bumpen naar `glowsuite_onboarding_v3_${user.id}` om oude half-afgemaakte states niet in nieuwe flow te injecteren.

## Wat expliciet NIET verandert

- Geen wijzigingen aan `index.css`, `tailwind.config.ts`, kleurtokens, gradients, DialogContent-classes, Button-varianten of iconografie-stijl.
- Geen andere pagina's of componenten bewerkt.
- `OnboardingGate.tsx` blijft ongewijzigd.
