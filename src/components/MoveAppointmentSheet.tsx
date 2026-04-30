import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { fineSlots } from "@/lib/agendaMove";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { cn } from "@/lib/utils";

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
}

export function MoveAppointmentSheet({
  open, onOpenChange, appointment,
  initialDate, initialTime, initialEmployeeId,
  employees, allowEmployeeChange, onConfirm,
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

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader>
          <DrawerTitle>Verplaats afspraak</DrawerTitle>
          <DrawerDescription className="text-xs">
            {appointment ? `Kies een nieuwe datum, tijd${allowEmployeeChange ? ' of medewerker' : ''}.` : ''}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-2 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Datum</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-xl bg-secondary/50 border border-border text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Tijd</label>
              <select
                value={time}
                onChange={e => setTime(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-xl bg-secondary/50 border border-border text-sm"
              >
                {fineSlots.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {allowEmployeeChange && employees.length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground">Medewerker</label>
              <div className="mt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setEmployeeId(null)}
                  className={cn(
                    "px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors",
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
                      "flex items-center gap-2 pl-1 pr-3 py-1 rounded-xl border transition-colors text-xs",
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

        <DrawerFooter>
          <Button variant="gradient" onClick={handleConfirm} disabled={saving}>
            {saving ? 'Bezig...' : 'Verplaatsen'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuleren</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
