# Agenda 3.0: one safe way to store appointments (prepared, inactive)

Status: proposal only. Nothing applied, nothing deployed, nothing in `src/` changed.

## Files
- `docs/proposed-migrations/2026-10-10_atomic_appointment_move.sql` (schema step 1):
  helpers `amsterdam_wall_to_utc`, `minutes_to_wall_time`, `appointment_busy_candidates`,
  `appointment_slot_check`; RPCs `move_appointment_atomic`, `create_appointment_atomic`,
  `create_public_booking_atomic`.
- `docs/proposed-migrations/2026-10-10_appointment_slot_guard.sql` (step 4): triggers that stop
  salon users from writing time/employee fields directly.
- `routes-inventory.md`: every write route and its status.
- `moveAppointmentCore.ts`, `moveAppointmentRpc.ts`: inactive client adapter + time/reminder helpers.
- `calendarPage.applyMove.patch.md`, `calendarPage.create.patch.md`, `public-booking.create.patch.md`.
- `tests/atomic-appointment-move/`: `run-local-pg.sh` (throwaway PostgreSQL, socket only),
  `fixture.sql`, `tests.sql`, `tests-phase2.sql`, `tests-phase3.sql`, `tests-guard.sql`, races,
  `adapter.test.ts` (`bunx vitest run --config tests/atomic-appointment-move/vitest.config.ts`).

## Guarantees (tested locally)
- All three write RPCs take the same lock per salon + local day, then check with the same
  `appointment_slot_check` (opening hours, weekly schedule, custom hours, breaks, absence,
  duration, overlaps incl. multi-employee links, unknown employees = salon-wide) and write in one
  transaction. Group lines, sub appointments and employee links: all or nothing.
- Employees only by UUID of the same salon and mode; names never resolved.
- New rows: real UTC + Amsterdam wall clock; end of day stored as `24:00`, slots past closing refused.
- Old rows recognised (wall clock as UTC); unreadable rows block both readings and cannot be moved.
- Move needs `updated_at`; checked after the row lock, before the no-op check.
- Rights: move/create = owner in active mode with eigenaar/admin/manager/receptie; online booking =
  service_role only, salon from slug; helpers not callable by app roles.
- With the guard active, direct writes of date/time/employee/links by salon users fail; notes,
  cancel and payment fields still work; past import rows still allowed.

## Schema comparison with production (structure only, no rows read)
- All columns written by the RPCs exist with compatible types. `settings.user_id` and
  `settings.public_slug` are unique, matching the RPC assumptions.
- Live triggers on `appointments`: `set_booking_reference` (before insert),
  `update_updated_at_column` (before update; RPC returns the stored value),
  `trg_invalidate_reminders_on_reschedule`, `trg_sync_rebook_revenue`, `trg_enqueue_dossier_automation`.
  None blocks the migration; the fixture models the first two.
- Unique `(appointment_id, employee_id)` on links and the exact-start unique index stay; the RPCs
  catch `unique_violation` as conflict.
- `payment_status` default is `none`; the booking RPC writes `unpaid`/`pending` like the Edge Function.
- No CHECK constraints on `appointments.status`/`source`. Table grants could not be read via
  `information_schema` (empty result); verify before step 1.
- Not modelled in the fixture: real RLS policies (a simplified owner policy is used in the guard test).

## Still open
- `seed-demo-data` (service_role, demo only) and any future service_role writer bypass the guard.
- Future-dated import rows are refused by the guard; import of future appointments needs its own RPC.
- Read side (agenda display around midnight, reminders, no-show, confirmations, .ics/e-mail) still
  uses raw `appointment_date` in live code; prepared helpers exist but are not wired in.
- `max_bookings_simultaneous` and `buffer_minutes` are not enforced (as today).
- Multi-employee appointments can be created but not moved (`multi_employee_unsupported`).
- Group bookings from the agenda: each person is stored as its own appointment with
  `booking_group_id` (same model as online groups). The legacy `sub_appointments` table has no time
  or employee per person, so lines without their own time are refused (`group_line_needs_time`).
  The agenda form must send a time per person (patch in `calendarPage.create.patch.md`).
- Before the guard, the current frontend still writes directly (unchanged behaviour until step 3/4).

## Rollout (each step separate written approval)
1. **Schema** `2026-10-10_atomic_appointment_move.sql`: new functions + flag column (default off).
   EXECUTE for nobody (PUBLIC, anon, authenticated, service_role revoked). Refuses to run if
   functions with these names already exist, unless `glowsuite.allow_replace=on` is set after review.
   No existing flow changes. Rollback: drop the new functions and the column.
2. **Online booking**: `..._activate_booking.sql` (EXECUTE to service_role) + deploy patched
   `public-booking` (keep a copy of the current one). The patch answers 503 if the RPC fails; it never
   falls back to the old insert. Rollback before step 4: redeploy the copy and revoke the grant.
3. **Agenda**: `..._activate_agenda.sql` (EXECUTE to authenticated) + publish frontend with the adapter,
   then switch `atomic_agenda_enabled` per salon (platform admin only). Flag off or missing = moves and
   creates blocked with a message (client and server both check). Viewing, notes, cancelling,
   payments stay available. Rollback before step 4: flag off (blocks), or republish previous frontend.
4. **Guard** `2026-10-10_appointment_slot_guard.sql`, only when steps 2 and 3 are live for every salon.
   From then on direct writes of time/employee/links fail for anon, authenticated and service_role.

## Safe rollback after step 4
- Safe to restore: any frontend from step 3 onward, any public-booking with the RPC patch.
- Old frontend republished anyway: viewing works; drag (mouse/touch), "Verplaats afspraak", new
  appointment and waitlist placement fail at the first write (tested G07: nothing changed). Not silent:
  the old code shows its generic error. Avoid; restore a step-3 version instead.
- Old public-booking redeployed anyway: live bookings fail at insert (G06), nothing half-written;
  customers see an error. Payment webhooks and demo seeding keep working.
- Do not drop the guard while an old frontend or old public-booking is live.
- Disabling the flag never re-opens a legacy path: the RPCs return `disabled`, direct writes stay
  blocked by the guard, online booking is not affected by the agenda flag (F05).

## Stap 1 als één transactie (beveiligingsfix)
- Het SQL-bestand bevat bewust geen BEGIN/COMMIT: de Lovable-migratietool (Drizzle) en de Supabase CLI zetten elk migratiebestand al in één transactie. Een eigen COMMIT zou die transactie te vroeg afsluiten.
- Handmatig alleen: `psql -1 -v ON_ERROR_STOP=1 -f 2026-10-10_atomic_appointment_move.sql`.
- Het script weigert te draaien buiten één transactie (transactie-lokale markering) en controleert vóór de commit via `has_function_privilege` en `pg_proc.proacl` dat PUBLIC, anon, authenticated en service_role niets mogen uitvoeren en dat `atomic_agenda_enabled` uit staat. Elke fout draait kolom en functies volledig terug.

## Stap 3 offline voorbereiding (2026-10-11, vervangt de oude stap-3-tekst hierboven)
- Nieuw: `agendaWriteCore.ts` (modus per salon, `guardedCreate`, `guardedPlaceWaitlist`), `wachtlijst.place.patch.md`;
  bijgewerkt: `calendarPage.create.patch.md` (vlag vóór de RPC), `calendarPage.applyMove.patch.md`.
- Modus: vlag `true` = alleen RPC, nooit terugval; vlag `false` of geen rij = huidige code ongewijzigd; vlag onleesbaar = niets opslaan.
  Publiceren verandert dus niets voor salons met de vlag uit.
- Activatie: (a) frontend publiceren, alle salons blijven op huidige code; (b) GRANT uit `..._activate_agenda.sql`;
  (c) vlag aan voor één demosalon, één fictieve test per route; (d) pas na GO van Chris Beautycare; (e) guard (stap 4) pas als alle salons aan staan, daarna legacy-code verwijderen.
- Terugval: vlag uit = direct terug naar huidige code (vóór stap 4). Na stap 4: vlag uit blokkeert.
- Blokkades voor aanzetten: groepsregel zonder eigen tijd wordt geweigerd (formulier moet tijd per persoon tonen);
  afspraken met meerdere medewerkers niet verplaatsbaar; weergave/herinneringen lezen nog ruwe `appointment_date`.

## Stap 3A server route (2026-10-11, inactief)
- Nieuw: `agendaCreateRoute.ts` (toekomstige Edge Function `agenda-create-appointment`), `docs/proposed-migrations/2026-10-11_agenda_create_route.sql` (NIET toegepast, niet in PostgreSQL getest), tests `tests/atomic-appointment-move/agenda-create-route.test.ts`.
- Route: login -> salon via current_tenant_id-regel -> rol -> vlag (onleesbaar = blokkeren, uit = weigeren) -> duurzame claim op `request_id` -> één RPC-aanroep met `_source='manual'` -> pas daarna bevestigingsmail-hand-off.
- BLOKKADE 1: live `create_appointment_atomic` gebruikt `auth.uid()` als salon én voor de vlag. Met service_role is dat NULL (`not_authenticated`); met een receptie/manager-login is het de verkeerde salon. Een service_role-only wrapper met (actor, tenant) is nodig (databasewijziging, aparte goedkeuring).
- BLOKKADE 2: de RPC kent geen idempotency-sleutel; zonder de voorgestelde tabel `agenda_create_requests` kan een herhaald verzoek zonder medewerker een tweede afspraak maken.
- BLOKKADE 3 (bestaand): groepsregel zonder eigen tijd, verplaatsen met meerdere medewerkers, oude lezers van ruwe `appointment_date`.
- Activatie: (1) wrapper + tabel, (2) route deployen, (3) frontend achter vlag, (4) tests, (5) vlag aan voor demosalon, één fictieve afspraak per scenario, (6) Beautycare alleen na toestemming Chris. Terugdraaien: vlag uit (agenda gebruikt weer huidige code), of grant intrekken; bestaande afspraken blijven staan.

## Stap 3A databasefunctie (2026-10-11, offline getest, NIET toegepast)
- `docs/proposed-migrations/2026-10-11_agenda_create_route.sql`: tabel `agenda_create_requests` (alleen ids, hash, mailkeuze), helper `agenda_actor_tenant` (niemand mag hem direct aanroepen), wrapper `create_appointment_atomic_as` (alleen service_role). Vervangt blokkade 1 en 2 hierboven.
- Wrapper bepaalt zelf de salon (eigenaar, of precies één actieve `user_access`; dubbelzinnig = weigeren), rol eigenaar/admin/manager/receptie, vlag (uit of geen rij = `disabled`), en roept de ONGEWIJZIGDE `create_appointment_atomic` aan met de eigenaar-identiteit, alleen binnen de transactie.
- Aanvraagregel en afspraak in één transactie; gelijktijdige gelijke ID wacht op de primaire sleutel en krijgt dezelfde afspraak terug; andere inhoud of andere mailkeuze = `request_mismatch`; geweigerde of mislukte poging laat niets achter.
- Gebruik: `agendaCreateRoute.ts` roept alleen deze wrapper aan; `GRANT ... TO authenticated` uit `..._activate_agenda.sql` is voor 3A NIET nodig.
- Lokale test: `bash tests/atomic-appointment-move/run-local-pg-3a.sh` (240/240, waarvan 50 nieuw voor 3A).
- Referentie public-booking bijgewerkt naar de actieve server (= goedgekeurde stap-2b-versie); vorige versie bewaard als `public-booking.reference-pre-step2b.index.ts`.
- Bekende beperking: demo/live van de medewerker wordt niet apart vergeleken; de eigenaar-instelling bepaalt de modus. Aanvraagregels worden niet automatisch opgeruimd (kleine tabel; opruimbeleid apart).
