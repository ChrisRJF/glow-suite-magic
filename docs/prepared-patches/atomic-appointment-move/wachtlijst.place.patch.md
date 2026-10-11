# Prepared change: WachtlijstPage "Plaats in agenda" (NOT applied)

```tsx
import { routeAgendaWrite, guardedPlaceWaitlist, BLOCKED_MESSAGE } from "@/lib/agendaWriteCore";

const res = await routeAgendaWrite(
  agendaMode,
  () => guardedPlaceWaitlist(entry, { mode: agendaMode, rpc: rpcAdapter, now: new Date(),
    markPlaced: async (id) => !!(await update(id, { status: "geplaatst" })) }),
  () => legacyPlace(entry),                            // LEGACY-UNCHANGED: today's code, flag off only
  () => ({ ok: false, code: "disabled", message: BLOCKED_MESSAGE, marked: false }),
);
if (!res.ok) { toast.error(res.message); return; }    // entry stays "wachtend"
if (!res.marked) toast.warning("Afspraak staat in de agenda, maar de wachtlijst is niet bijgewerkt. Zet de status handmatig.");
```

- Date = tomorrow in Europe/Amsterdam, time = `preferred_time` or 10:00, no employee
  (`preferred_employee` is a name and is never resolved). Busy/closed = refused, nothing saved.
