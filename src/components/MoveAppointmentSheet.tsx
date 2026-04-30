import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { fineSlots } from "@/lib/agendaMove";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon, Clock, User } from "lucide-react";

export interface MoveTarget {
  date: string;          // YYYY-MM-DD
  time: string;          // HH:MM
  employeeId: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: any | null;
  initialDate: string;
  initialTime: string;
  initialEmployeeId: string | null;
  employees: { id: string; name: string; photo_url?: string | null; color?: string | null }[];
  /** Allow choosing an employee. False when DB has no employees (legacy/demo). */
  allowEmployeeChange: boolean;
  onConfirm: (target: MoveTarget) => Promise<void> | void;
  /** Optional summary metadata for the appointment (rendered at the top). */
  summary?: { customer?: string; service?: string; currentTime?: string };
}

export function MoveAppointmentSheet({
  open, onOpenChange, appointment,
  initialDate, initialTime, initialEmployeeId,
  employees, allowEmployeeChange, onConfirm, summary,
}: Props) {
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [employeeId, setEmployeeId] = useState<string | null>(initialEmployeeId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(initialDate);
      setTime(initialTime);
      setEmployeeId(initialEmployeeId);
    }
  }, [open, initialDate, initialTime, initialEmployeeId]);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await onConfirm({ date, time, employeeId });
    } finally {
      setSaving(false);
    }
  };

  const fieldClass =
    "w-full h-14 px-4 rounded-2xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-colors";

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle>Verplaats afspraak</DrawerTitle>
          <DrawerDescription className="text-xs">
            Kies een nieuwe datum, tijd{allowEmployeeChange ? ' of medewerker' : ''}.
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-4 space-y-4 overflow-y-auto">
          {/* Summary card */}
          {summary && (summary.customer || summary.service) && (
            <div className="rounded-2xl bg-secondary/40 border border-border p-3 flex flex-col gap-1">
              {summary.customer && (
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="line-clamp-1">{summary.customer}</span>
                </div>
              )}
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                {summary.service && <span className="line-clamp-1">{summary.service}</span>}
                {summary.currentTime && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />nu om {summary.currentTime}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Date + time: stacked on small, equal cols on >=sm */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <CalendarIcon className="w-3 h-3" /> Datum
              </label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> Tijd
              </label>
              <select
                value={time}
                onChange={e => setTime(e.target.value)}
                className={fieldClass}
              >
                {fineSlots.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {allowEmployeeChange && employees.length > 0 && (
            <div className="flex flex-col gap-2">
              <label className="text-xs text-muted-foreground">Medewerker</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setEmployeeId(null)}
                  className={cn(
                    "h-10 px-3 rounded-xl text-xs font-medium border transition-colors",
                    employeeId === null
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground"
                  )}
                >
                  Geen
                </button>
                {employees.map(emp => (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => setEmployeeId(emp.id)}
                    className={cn(
                      "h-10 flex items-center gap-2 pl-1.5 pr-3 rounded-xl border transition-colors text-xs",
                      employeeId === emp.id
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-card hover:border-primary/40"
                    )}
                  >
                    <EmployeeAvatar employee={emp as any} size="sm" ring={false} />
                    <span className="font-medium">{emp.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DrawerFooter className="gap-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <Button variant="gradient" className="h-14 rounded-2xl text-base" onClick={handleConfirm} disabled={saving}>
            {saving ? 'Bezig...' : 'Verplaatsen'}
          </Button>
          <Button variant="outline" className="h-12 rounded-2xl" onClick={() => onOpenChange(false)}>Annuleren</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
