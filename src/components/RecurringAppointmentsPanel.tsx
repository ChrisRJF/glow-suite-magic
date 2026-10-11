import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Repeat, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  RECURRING_COUNTS, recurringCountLabel, amsterdamDate, batchKey, biweeklyDates, buildBatch, loadBatch, recurringTemplate, routeCreate, runBatch,
  type Batch, type RunResult, type SourceAppointment, type Store,
} from "@/lib/recurringAppointments";

const store: Store = { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: (k) => localStorage.removeItem(k) };
const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function RecurringAppointmentsPanel({ appointment, links, userId, tenantId, onCreated }: {
  appointment: SourceAppointment; links: { appointment_id: string; employee_id: string }[]; userId: string; tenantId: string; onCreated: () => void;
}) {
  const key = batchKey(userId, tenantId, appointment.id);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(4);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => { setOpen(false); setResult(null); setError(null); setBatch(loadBatch(store, key)); }, [key]);

  const tpl = recurringTemplate(appointment, links);
  const today = amsterdamDate(new Date())!;
  const dates = tpl.ok ? biweeklyDates(tpl.date, today, count) : [];

  const run = async (b: Batch) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    const r = await runBatch(store, key, b, routeCreate((n, o) => supabase.functions.invoke(n, o) as any), setBatch);
    if (r.kind === "storage") setError("Deze browser kan de reeks niet veilig bewaren. Er is niets opgeslagen.");
    setResult(r); setBusy(false); inFlight.current = false;
    onCreated();
  };

  const confirm = () => {
    if (!tpl.ok || inFlight.current) return;
    const existing = loadBatch(store, key);
    if (existing) { setBatch(existing); return; }
    const b = buildBatch(appointment.id, tpl, dates, () => crypto.randomUUID());
    if (b.ok === false) { setError(b.message); return; }
    setBatch(b.batch); run(b.batch);
  };

  const close = () => { try { store.remove(key); } catch { /* ignore */ } setBatch(null); setResult(null); setOpen(false); };

  if (!open) return <Button variant="outline" className="w-full" onClick={() => setOpen(true)}><Repeat className="w-4 h-4" /> Herhaalafspraken</Button>;

  const created = batch?.items.filter((i) => i.status === "created") ?? [];
  const allDone = !!batch && created.length === batch.items.length;
  const blocked = batch?.items.find((i) => i.status === "refused");
  const uncertain = batch?.items.find((i) => i.status === "unknown");

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
      <h3 className="text-sm font-semibold">Herhaalafspraken · elke 2 weken</h3>
      {tpl.ok === false && <p className="flex gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{tpl.message}</p>}
      {tpl.ok && !batch && (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Aantal extra afspraken">
            {RECURRING_COUNTS.map((n) => <Button key={n} size="sm" variant={n === count ? "default" : "outline"} onClick={() => setCount(n)}>{recurringCountLabel(n)}</Button>)}
          </div>
          <p className="text-xs text-muted-foreground">Zelfde klant, behandeling en medewerker, om {tpl.time}. De huidige afspraak blijft zoals hij is. Er wordt geen bevestiging verstuurd.</p>
          <p className="text-sm font-medium">{count} extra afspraken · iedere 2 weken</p>
          <ul className="max-h-60 overflow-y-auto space-y-1 text-sm rounded-xl border border-border p-2">{dates.map((d) => <li key={d}>{fmt(d)} · {tpl.time}</li>)}</ul>
          <Button className="w-full" disabled={busy} onClick={confirm}>{count} afspraken inplannen</Button>
        </>
      )}
      {batch && (
        <div className="space-y-3 text-sm">
          <p className="font-medium">{created.length} van {batch.items.length} ingepland{busy ? " · bezig met inplannen..." : ""}</p>
          <ul className="max-h-60 overflow-y-auto space-y-1 rounded-xl border border-border p-2">{batch.items.map((i) => (
            <li key={i.body.request_id} className="flex justify-between gap-2"><span>{fmt(i.date)} · {i.body.time}</span>
              <span className="text-muted-foreground">{i.status === "created" ? "Ingepland" : i.status === "refused" ? "Geblokkeerd" : i.status === "unknown" ? "Onzeker" : "Nog niet"}</span></li>
          ))}</ul>
          {allDone && <p className="flex gap-2 rounded-xl bg-secondary/60 p-3"><CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />{created.length} afspraken ingepland.</p>}
          {blocked && <p className="flex gap-2 rounded-xl bg-destructive/10 p-3 text-destructive"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />Gestopt op {fmt(blocked.date)}: {blocked.message} {created.length} van {batch.items.length} zijn ingepland. De rest is niet ingepland.</p>}
          {!blocked && uncertain && <p className="flex gap-2 rounded-xl bg-destructive/10 p-3 text-destructive"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />Niet zeker of {fmt(uncertain.date)} is opgeslagen. {created.length} van {batch.items.length} zijn zeker ingepland. Hervatten verstuurt exact dezelfde aanvragen, zonder dubbele afspraken.</p>}
          {!allDone && !blocked && !busy && !result && !uncertain && <p className="text-muted-foreground">Deze reeks is nog niet afgerond. {created.length} van {batch.items.length} ingepland.</p>}
          <div className="flex gap-2">
            {!allDone && !blocked && <Button size="sm" disabled={busy} onClick={() => run(batch)}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Hervatten</Button>}
            {(allDone || blocked) && <Button size="sm" variant="ghost" onClick={close}>Sluiten</Button>}
          </div>
        </div>
      )}
      {error && <p className="flex gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{error}</p>}
    </div>
  );
}
