# Write routes for appointments (source read 2026-10-10, nothing changed)

Legend: N = new appointment, T = time/employee change, O = other change (no availability effect).
"Lock" = takes `appointment_slot:<tenant>:<date>` and re-checks inside one transaction.

| Route | Kind | Stored today | Checks today | Lock today | Prepared |
|---|---|---|---|---|---|
| Agenda "Nieuwe afspraak" (`CalendarPage` insert + separate `appointment_employees` + `sub_appointments` inserts) | N | wall clock as UTC (`${date}T${time}:00`), names in notes | client only, exact same start per employee | no | `create_appointment_atomic` (`calendarPage.create.patch.md`) |
| Agenda drag/drop, touch sheet, "Verplaats afspraak" (`applyMove`) | T | update + link delete/insert, wall clock as UTC | client `findConflict` | no | `move_appointment_atomic` (`calendarPage.applyMove.patch.md`) |
| Agenda status change (`update(id,{status})`) | O (re-activation = T) | status | none | no | guard blocks re-activation of a cancelled row |
| Online booking (`public-booking` create_booking) | N (groups) | real UTC, links in separate insert | booking v2 server check, unique index on exact start | no | `create_public_booking_atomic` (`public-booking.create.patch.md`) |
| Wachtlijst "Plaats in agenda" (`WachtlijstPage` handlePlace) | N | browser-time UTC, **no start_time/end_time, no employee**, name in notes | none | no | `create_appointment_atomic` source `waitlist` (`wachtlijst.place.patch.md`) |
| Klantdossier / handmatig herboeken | N via agenda form | as agenda | as agenda | no | covered by agenda create |
| Automatisch herboeken (`autoRebookPass`, AutoRebookCenter) | none (sends link; customer books online) | rebook_actions only | n/a | n/a | booking goes through public-booking RPC |
| Group booking agenda (`sub_appointments`) | N | sub rows without time/employee | none | no | each person = own appointment row with `booking_group_id`, own checks, all or nothing; legacy line without time refused |
| Import afspraken (`ImportWizard`) | N | as given in file, `source='import'` | duplicate skip only | no | guard allows only past rows; future import rows need a later RPC |
| Historische import (`HistoricalImport`) | none (dossier entries, not appointments) | `historical_dossier_entries` | n/a | n/a | not affected |
| Payment webhooks / create-payment / viva / mollie / public-booking status update | O | payment/status fields | service_role | n/a | unchanged |
| Cancel (`cancel-appointment`, `appointment-confirm` decline, expire holds) | O (frees time) | status cancelled | service_role | n/a | unchanged |
| `appointment-confirm` confirm | O | confirmation fields | service_role | n/a | unchanged |
| `seed-demo-data` | N (demo only) | wall clock as UTC | none, service_role | no | **not covered**; demo data only |
| AutoRevenueEngine | none (simulation, "NO inserts") | - | - | - | - |

Findings
- Today no route takes a lock; the only database protection is the unique index on
  (tenant, employee_id text, exact start), which does not catch other start times, group rows or links.
- Agenda create checks only identical start times per employee: overlapping other start times are allowed.
- Waitlist placement writes no start/end time and no employee: such rows read as "ambiguous" and
  block both possible readings (fail closed); they cannot be moved until the time is set.
- Agenda create stores legacy employee names in notes; links are written separately and a link
  failure is only logged (appointment stays without employee).
- service_role routes are not stopped by the guard; only `public-booking` creates appointments there.
