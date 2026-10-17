# Atomic Agenda punt 1: inactieve voorbereiding

Geen actieve frontend/Edge-code, SQL, grants, flags of gegevens gewijzigd. CalendarPage.applyMove blijft volledig intact, inclusief de bekende losse afspraak-/medewerkerwrites. De productiebug is dus nog niet gerepareerd.

## Voorbereid

- agendaMoveClient.ts: geïnjecteerde serveraanroep, versiecontrole, legacy/atomic/blocked-selectie. Geen directe browser-RPC, automatische retry of fallback binnen atomic modus. Zonder wrapper is atomic unavailable.
- agendaMoveRoute.ts: pure INACTIEVE serverroutekern, geen inzetbare Edge-entrypoint. Geverifieerde identiteit, server-resolved salon/rol/demo, gate, volledige salon-/demo-gebonden read. Groep/multiple links geblokkeerd vóór noop/writes.
- Volledige groepsdetectie moet booking_group_id/siblings én sub_appointments.parent_appointment_id omvatten; onvolledige reads zijn geen nul links/geen groep.

## DB-wrappervoorstel, NIET uitgevoerd of als SQL geïmplementeerd

Benodigd: public.move_appointment_atomic_as(_actor uuid, _appointment_id uuid, _target_date text, _target_start text, _target_employee_id uuid, _expected_updated_at timestamptz).

Alleen service-role EXECUTE op de nieuwe wrapper, nooit authenticated/anon/PUBLIC. Geen browsergrant op move_appointment_atomic. Actor uitsluitend uit server auth.getUser, niet uit body. Hergebruik create-as model voor agenda_actor_tenant, operationele rollen en demo/live-binding, zonder blind tijdelijke owner-identiteit te kopiëren en oorspronkelijke actorcontrole te verliezen.

Wrapper hercontroleert in één transactie onder passende slot-/rowlocks salon/rol/mode/gate, eigenaarschap, versie, status, volledige groepsrelaties en medewerkerlinks. Group/multi-employee-check vóór noop/writes. Concurrente link-/groepwijzigingen mogen die controles niet passeren: lockprotocol moet alle andere schrijvers omvatten, anders blijft activatie geblokkeerd. Hergebruik move-slot-/beschikbaarheid-/Amsterdam-tijdlogica; geen losse linkwrites buiten die transactie.

Bestaand move-RPC heeft geen bewezen groepsverplaatscontract. Groepen blijven ongewijzigd in legacy zolang atomic niet geselecteerd is; in atomic weigeren zonder legacy fallback. Succes uitsluitend moved/noop met dezelfde afspraak-ID en versie. Stale/conflict/unknown vereisen verversen; transportfout bewijst niet dat niets opgeslagen is.

## Afzonderlijke GO's

1. DB-wrapperimplementatie/review, lock-/rollbacktests en DB/permissions-GO zonder authenticated RPC-grants.
2. Serveradapter/Edge-entrypoint en deployment-GO; pure routekern is nog geen inzetbare functie.
3. Frontendkoppeling, activatie-GO en publicatie-GO. Routebeschikbaarheid eerst bewijzen; geen flags/koppeling in deze ronde.
4. Desktopdrag, mobiele sheet, verplaatsdialoog en Smart Reflow behouden één applyMove en boolean/refetch-contract. Reflow wordt geen transactionele batch; geen groepverplaatsing claimen.

Historische moveAppointmentRpc.ts en calendarPage.applyMove.patch.md zijn NIET het activatiepad: zij veronderstellen directe browser-RPC-toegang. Gebruik de nieuwe servervoorbereiding.

## Stap 2 (2026-10-17), inactief

- DB-wrapper uitgeschreven als voorstel: docs/proposed-migrations/2026-10-17_move_appointment_atomic_as.sql. NIET uitgevoerd.
- Groepsleden (booking_group_id) verplaatsen individueel: alleen deze afspraak wijzigt; groep, andere leden en hun koppelingen blijven ongemoeid. Route eist dat de wrapper dezelfde groep terugmeldt.
- Nog geweigerd vóór writes: meerdere medewerkers en afspraken met sub_appointments.
