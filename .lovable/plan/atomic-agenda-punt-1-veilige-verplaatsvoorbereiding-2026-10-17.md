# Atomic Agenda punt 1: veilige verplaatsvoorbereiding

- Laat `CalendarPage.applyMove` en de bestaande desktop-/mobielbediening ongewijzigd. De huidige losse writes worden hiermee nog niet gerepareerd.
- Bereid één inactieve TypeScript-verplaatsroute voor, via een toekomstige serverwrapper in plaats van directe authenticated RPC-toegang.
- Behoud legacy uitsluitend als vooraf gekozen modus. Atomic fouten, onbekende beschikbaarheid en ontbrekende versie krijgen nooit een legacy fallback.
- Bereid servercontroles voor identiteit, salon, rol, demo/live en gate voor. Blokkeer niet-ondersteunde groeps-/multi-medewerkerverplaatsingen vóór writes; laat bestaande legacy-functionaliteit intact.
- Documenteer het benodigde service-only DB-wrappercontract als voorstel, zonder SQL uit te voeren of rechten toe te voegen.
- Draai gerichte, fictieve tests en werk alleen de relevante roadmapregel bij.

## Technische grenzen

Alle nieuwe routecode blijft in `docs/prepared-patches/atomic-appointment-move/`, niet geïmporteerd door actieve frontend of Edge Functions. Geen DB-verzoeken, deployment, flags, klantdatawrites of publicatie. Aparte GO vereist voor DB-wrapper, serverdeployment, frontendkoppeling en activatie.