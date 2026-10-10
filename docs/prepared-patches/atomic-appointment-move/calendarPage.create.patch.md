# Prepared change: agenda create + wachtlijst through one RPC (NOT applied)

## CalendarPage "Nieuwe afspraak"
Replace `insert(...)` + `appointment_employees` insert + `sub_appointments` loop with:

```tsx
const { data: res, error } = await (supabase.rpc as any)("create_appointment_atomic", {
  _customer_id: form.customer_id,
  _service_id: form.service_id,
  _date: form.date,                 // Amsterdam local date
  _time: form.time,                 // Amsterdam wall clock; server stores real UTC
  _employee_ids: selectedEmployeeIds, // UUIDs only, first = primary; [] = not assigned
  _notes: subAppts.length > 0 ? `Groepsboeking: ${subAppts.length + 1} personen` : "",
  _source: "manual",
  _journey_id: journeyLink?.id ?? null,
  _journey_session: journeyLink?.session ?? null,
  // each extra person = own appointment row in the same booking_group_id, own time/service/employee
  _sub_appointments: subAppts.filter(s => s.person_name && s.service_id).map(s => ({
    person_name: s.person_name, service_id: s.service_id,
    time: s.assigned_time || form.time,             // required; no time => refused, never guessed
    employee_id: s.assigned_employee_id ?? null,     // UUID only; names are never sent
  })),
});
if (!isAgendaGateOn(flags)) { toast.error("Afspraak opslaan is even niet beschikbaar."); return; }
if (error || !res?.ok) { toast.error(createMessage(res?.code, error)); return; }  // no fallback insert
```
- Names are no longer written as "Medewerker: X" for new rows (the links are the truth).
- Error or missing RPC => message "Afspraak opslaan is even niet beschikbaar. Er is niets opgeslagen."

## WachtlijstPage "Plaats in agenda"
Today: `appointment_date = new Date()+1 day at preferred_time` in browser time, no start/end, no employee.
Prepared: same RPC with `_date` = tomorrow in Amsterdam, `_time` = `preferred_time || "10:00"`,
`_employee_ids` = `[]` (preferred_employee is a name: never resolved), `_source: "waitlist"`.
Refused (busy, closed, absent) => message, entry stays on the waitlist (status not changed).
The waitlist status update runs only after `res.ok`.

## Read side (agenda display, reminders, no-show, confirmations)
Use `appointmentLocalSlot` / `appointmentInstant` / `reminderDue` from `moveAppointmentCore.ts`
instead of `appointment_date.slice(0,10)` and raw instants. Unknown time => shown with a warning,
no reminder sent (flagged), never shifted.
