# Prepared change for src/pages/CalendarPage.tsx `applyMove` (NOT applied)

One entry point for every move. Mode is decided before any write (see `agendaWriteCore.ts`).

```tsx
import { moveAppointmentAtomic } from "@/lib/moveAppointmentRpc";
import { routeAgendaWrite, BLOCKED_MESSAGE } from "@/lib/agendaWriteCore";

const applyMove = async (apt: any, target: MoveTarget) => routeAgendaWrite(
  agendaMode,
  async () => {
    const res = await moveAppointmentAtomic(
      { id: apt.id, updated_at: apt.updated_at },        // missing updated_at => blocked
      { ...target, time: snapToFine(target.time) },      // employeeId = UUID or null
      true,
    );
    if (!res.ok) { toast.error(res.message); await Promise.all([refetch(), refetchApptEmps()]); return false; }
    if (res.code === "noop") return true;
    await Promise.all([refetch(), refetchApptEmps()]);
    toast.success("Afspraak verplaatst");
    return true;
  },
  () => applyMoveLegacyUnchanged(apt, target),          // LEGACY-UNCHANGED, flag off only
  () => { toast.error(BLOCKED_MESSAGE); return false; },
);
```

Paths that call this `applyMove` and nothing else:
- desktop mouse drag (day view and employee columns, also to another employee): `handleDragEnd` -> `applyMove`
- touch drag: `handleDragEnd` opens `MoveAppointmentSheet`; onConfirm -> `applyMove`; onCancel -> close sheet, no write
- "Verplaats afspraak" dialog -> `applyMove`

The appointment query must select `updated_at`. After `stale` the agenda reloads.
In atomic mode the client `findConflict` is only a hint; the server decides.
