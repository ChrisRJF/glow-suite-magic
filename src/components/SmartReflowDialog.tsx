// SmartReflowDialog — "Slim plannen" / AI auto reflow
// Reorganises a day's appointments using a chosen strategy, shows a preview,
// then batch-applies the moves via the parent's applyMove() function.

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  timeToMinutes,
  minutesToTime,
  snapToFine,
  findConflict,
} from "@/lib/agendaMove";

export type ReflowStrategy =
  | "minimal_gaps"
  | "cluster_employee"
  | "max_revenue"
  | "compact_day";

const STRATEGIES: {
  value: ReflowStrategy;
  label: string;
  description: string;
}[] = [
  {
    value: "minimal_gaps",
    label: "Minimal gaps",
    description: "Vul lege plekken op tussen afspraken.",
  },
  {
    value: "cluster_employee",
    label: "Cluster per medewerker",
    description: "Groepeer afspraken per medewerker achter elkaar.",
  },
  {
    value: "max_revenue",
    label: "Maximale omzet",
    description: "Plaats duurste behandelingen op piekuren.",
  },
  {
    value: "compact_day",
    label: "Sneller klaar",
    description: "Compacte dag, vroegst mogelijke einde.",
  },
];

export interface ReflowAppointment {
  id: string;
  start: string; // HH:MM
  end: string;
  date: string; // YYYY-MM-DD
  durationMin: number;
  employeeId: string | null;
  employeeName: string | null;
  customerName: string;
  serviceName: string;
  servicePrice: number;
  raw: any;
}

export interface PlannedMove {
  id: string;
  customerName: string;
  serviceName: string;
  fromTime: string;
  toTime: string;
  fromEmployee: string | null;
  toEmployee: string | null;
  toEmployeeId: string | null;
  date: string;
  changed: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  date: string;
  appointments: ReflowAppointment[];
  allAppointments: any[];
  apptEmployees: any[];
  services: any[];
  /** when no DB employee assigned, the legacy fallback name still helps grouping */
  applyMove: (
    apt: any,
    target: { date: string; time: string; employeeId: string | null }
  ) => Promise<boolean>;
}

const DAY_START = "09:00";
const DAY_END = "18:00";

function planSchedule(
  appts: ReflowAppointment[],
  strategy: ReflowStrategy
): PlannedMove[] {
  if (appts.length === 0) return [];

  // Sort source list per strategy
  let sorted = [...appts];
  if (strategy === "max_revenue") {
    sorted.sort((a, b) => b.servicePrice - a.servicePrice);
  } else if (strategy === "cluster_employee") {
    sorted.sort((a, b) => {
      const ea = a.employeeName || "zzz";
      const eb = b.employeeName || "zzz";
      if (ea !== eb) return ea.localeCompare(eb);
      return timeToMinutes(a.start) - timeToMinutes(b.start);
    });
  } else {
    // minimal_gaps + compact_day: order by current start so we keep relative order
    sorted.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  }

  // Per-employee cursor (in minutes) for next free slot
  const cursors = new Map<string, number>();
  const dayStart = timeToMinutes(DAY_START);
  const dayEnd = timeToMinutes(DAY_END);

  const moves: PlannedMove[] = [];

  for (const a of sorted) {
    const empKey = a.employeeId || a.employeeName || "__unassigned__";
    const cursor = cursors.get(empKey) ?? dayStart;
    let newStart = cursor;
    if (newStart + a.durationMin > dayEnd) {
      // Can't fit — keep at original
      newStart = timeToMinutes(a.start);
    }
    const snapped = snapToFine(minutesToTime(newStart));
    cursors.set(empKey, timeToMinutes(snapped) + a.durationMin);

    moves.push({
      id: a.id,
      customerName: a.customerName,
      serviceName: a.serviceName,
      fromTime: a.start,
      toTime: snapped,
      fromEmployee: a.employeeName,
      toEmployee: a.employeeName,
      toEmployeeId: a.employeeId,
      date: a.date,
      changed: snapped !== a.start,
    });
  }

  return moves;
}

export function SmartReflowDialog({
  open,
  onOpenChange,
  date,
  appointments,
  allAppointments,
  apptEmployees,
  services,
  applyMove,
}: Props) {
  const [strategy, setStrategy] = useState<ReflowStrategy>("minimal_gaps");
  const [applying, setApplying] = useState(false);

  const plan = useMemo(
    () => planSchedule(appointments, strategy),
    [appointments, strategy]
  );

  const changedCount = plan.filter(p => p.changed).length;

  const handleApply = async () => {
    setApplying(true);
    let moved = 0;
    let skipped = 0;
    // Apply sequentially to keep conflict detection consistent
    for (const m of plan) {
      if (!m.changed) continue;
      const apt = allAppointments.find(a => a.id === m.id);
      if (!apt) continue;
      // Pre-check conflicts using the latest snapshot
      const svc = services.find(s => s.id === apt.service_id);
      const dur = svc?.duration_minutes || 30;
      const conflict = findConflict({
        movingId: m.id,
        date: m.date,
        startTime: m.toTime,
        durationMinutes: dur,
        targetEmployeeId: m.toEmployeeId,
        targetEmployeeName: m.toEmployee,
        appointments: allAppointments,
        apptEmployees,
        services,
      });
      if (conflict) {
        skipped++;
        continue;
      }
      const ok = await applyMove(apt, {
        date: m.date,
        time: m.toTime,
        employeeId: m.toEmployeeId,
      });
      if (ok) moved++;
      else skipped++;
    }
    setApplying(false);
    if (moved > 0) {
      toast.success(`Planning geoptimaliseerd · ${moved} afspraak${moved === 1 ? "" : "en"} verplaatst`);
    } else {
      toast.message("Geen wijzigingen toegepast");
    }
    if (skipped > 0) {
      toast.message(`${skipped} overgeslagen i.v.m. conflicten`);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Slim plannen
          </DialogTitle>
          <DialogDescription>
            Optimaliseer de planning van vandaag automatisch.
          </DialogDescription>
        </DialogHeader>

        {/* Strategy selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {STRATEGIES.map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => setStrategy(s.value)}
              className={cn(
                "text-left p-3 rounded-2xl border transition-all",
                strategy === s.value
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-secondary/40"
              )}
            >
              <div className="text-sm font-medium">{s.label}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {s.description}
              </div>
            </button>
          ))}
        </div>

        {/* Preview */}
        <div className="mt-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">
              Voorbeeld
            </span>
            <span className="text-[11px] text-muted-foreground">
              {changedCount} wijziging{changedCount === 1 ? "" : "en"}
            </span>
          </div>
          <div className="rounded-2xl border border-border overflow-hidden">
            {plan.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                Geen afspraken op {date}.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {plan.map(p => (
                  <li
                    key={p.id}
                    className={cn(
                      "p-3 text-sm flex items-center gap-3",
                      p.changed && "bg-primary/5"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.customerName}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {p.serviceName}
                        {p.toEmployee ? ` · ${p.toEmployee}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs tabular-nums shrink-0">
                      <span
                        className={cn(
                          p.changed ? "line-through text-muted-foreground" : ""
                        )}
                      >
                        {p.fromTime}
                      </span>
                      {p.changed && (
                        <>
                          <ArrowRight className="w-3 h-3 text-primary" />
                          <span className="font-semibold text-primary">
                            {p.toTime}
                          </span>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="mt-2 gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={applying}
          >
            Annuleren
          </Button>
          <Button
            onClick={handleApply}
            disabled={applying || changedCount === 0}
            className="gap-2"
          >
            {applying && <Loader2 className="w-4 h-4 animate-spin" />}
            Toepassen ({changedCount})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
