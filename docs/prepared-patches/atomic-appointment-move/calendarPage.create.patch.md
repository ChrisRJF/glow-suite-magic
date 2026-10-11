# Prepared change: agenda "Nieuwe afspraak" through one RPC (NOT applied)

Correction vs. previous version: the gate was checked AFTER the RPC. Now the mode is decided
first; `guardedCreate` refuses to call the server unless mode is `atomic`.

```tsx
import { routeAgendaWrite, guardedCreate, BLOCKED_MESSAGE } from "@/lib/agendaWriteCore";
// agendaMode = agendaModeFromFlagRead(await supabase.from("tenant_feature_flags")
//   .select("atomic_agenda_enabled").eq("tenant_id", tenantId).maybeSingle())

const res = await routeAgendaWrite(
  agendaMode,
  () => guardedCreate({
    customerId: form.customer_id, serviceId: form.service_id,
    date: form.date, time: form.time,                 // Amsterdam wall clock; server stores real UTC
    employeeIds: selectedEmployeeIds,                 // UUIDs only, first = primary
    notes: subAppts.length > 0 ? `Groepsboeking: ${subAppts.length + 1} personen` : "",
    source: "manual", journey: journeyLink,
    group: subAppts.map(s => ({ personName: s.person_name, serviceId: s.service_id,
      time: s.assigned_time || null, employeeId: s.assigned_employee_id ?? null })),
  }, { mode: agendaMode, rpc: rpcAdapter }),
  () => legacyCreate(),                               // LEGACY-UNCHANGED: today's code, flag off only
  () => ({ ok: false, code: "disabled", message: BLOCKED_MESSAGE }),
);
if (!res.ok) { toast.error(res.message); return; }   // no fallback insert in atomic mode
```

- Group line without own time: refused (`group_line_needs_time`) in atomic mode, never guessed.
  The group form must show a time per person before a salon is switched on.
- The client pre-check on identical start times stays only in `legacyCreate`.
- `legacyCreate` = the current body of `handleAdd` moved into a function, byte-identical.
  It is deleted together with the guard (step 4).
