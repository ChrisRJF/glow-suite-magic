# Werktijden per medewerker (offline, niet actief)

Bevinding: de publieke boekingsfunctie gebruikt vaste voorbeeldmedewerkers (Bas, Roos, Lisa, Emma) en
controleert geen werktijden per medewerker. De database kent alleen `working_days` en pauzes.

Voorbereid:
- `docs/proposed-migrations/2026-10-10_employee_weekly_schedule.sql` — kolom `weekly_schedule` (NULL = huidig gedrag).
- `supabase/functions/_shared/inactive/employeeSchedule.ts` — `withinSchedule()` regel, fail-closed.
- `src/test/employee-schedule.test.ts`.

Activering (elke stap aparte toestemming):
1. Migratie toepassen.
2. EmployeesPage: per weekdag begin/eindtijd invoeren en opslaan in `weekly_schedule`.
3. Interne agenda: tijden buiten schema grijs tonen.
4. public-booking: vaste EMPLOYEES vervangen door echte actieve medewerkers van de salon;
   bij `create_booking` `withinSchedule()` + pauzes + `employee_availability_exceptions` controleren,
   anders 409 weigeren. Beschikbare tijdsloten op dezelfde regel baseren.
Bestaande afspraken, pauzes, verlof en uitzonderingen blijven ongewijzigd.
