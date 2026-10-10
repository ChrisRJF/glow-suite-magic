# Prepared change for src/pages/CalendarPage.tsx (NOT applied)

Replace the body of `applyMove` (appointment update + separate appointment_employees
delete/insert) with one RPC call. MoveAppointmentSheet, drag handlers and toasts stay.

```tsx
import { moveAppointmentAtomic } from "@/lib/moveAppointmentRpc";

const applyMove = async (apt: any, target: MoveTarget) => {
  const res = await moveAppointmentAtomic(apt.id, { ...target, time: snapToFine(target.time) }, apt.updated_at);
  if (!res.ok) { toast.error(res.message); return false; }
  if (res.code === "noop") return true;
  await Promise.all([refetch(), refetchApptEmps()]);
  await new Promise<void>(r => setTimeout(r, 0));
  toast.success("Afspraak verplaatst");
  return true;
};
```

Behind a feature gate during rollout:

```tsx
const applyMove = atomicMoveEnabled ? applyMoveAtomic : applyMoveLegacy;
```

`handleDragEnd` keeps its client pre-checks (fast feedback, no write) and then calls
`applyMove` (desktop) or opens the sheet (touch), whose confirm also calls `applyMove`.
So every path ends in the same server validation.
