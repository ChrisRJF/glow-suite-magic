# Prepared change for src/pages/CalendarPage.tsx (NOT applied)

`applyMove` gets ONE implementation. The old body (separate `appointments.update` plus
`appointment_employees` delete/insert) is removed completely. No legacy path, no feature-flag
switch back to it. Gate off or server missing = the move is blocked with a message.

```tsx
import { moveAppointmentAtomic } from "@/lib/moveAppointmentRpc";

// atomicMoveEnabled comes from tenant_feature_flags (read-only for salons). Off = blocked.
const applyMove = async (apt: any, target: MoveTarget) => {
  const res = await moveAppointmentAtomic(
    { id: apt.id, updated_at: apt.updated_at },          // missing updated_at => blocked
    { ...target, time: snapToFine(target.time) },
    atomicMoveEnabled,
  );
  if (!res.ok) { toast.error(res.message); await Promise.all([refetch(), refetchApptEmps()]); return false; }
  if (res.code === "noop") return true;
  await Promise.all([refetch(), refetchApptEmps()]);
  await new Promise<void>(r => setTimeout(r, 0));
  toast.success("Afspraak verplaatst");
  return true;
};
```

Paths that must call this `applyMove` and nothing else:
- mouse drag (desktop) in day view and employee columns: `handleDragEnd` -> `applyMove`
- touch drag: `handleDragEnd` opens `MoveAppointmentSheet`; its confirm -> `applyMove`
- the "Verplaats afspraak" button / dialog -> `applyMove`

The appointment query must select `updated_at` (otherwise every move is blocked by design).
After a `stale` answer the agenda reloads so the next try uses the new version.

Direct agenda CREATE (`appointments.insert` in CalendarPage, around the two `appointment_date: dt`
writes) is NOT covered: it still writes wall clock as UTC and does not take the slot lock. See README.
