import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Clock, GripVertical, ArrowRightLeft } from "lucide-react";
import { EmployeeAvatarStack } from "@/components/EmployeeAvatar";
import { cn } from "@/lib/utils";
import { fineSlots, timeToMinutes } from "@/lib/agendaMove";

export interface ColumnEmployee {
  id: string;
  name: string;
  color?: string | null;
  photo_url?: string | null;
  role?: string | null;
}

interface DraggableAppointmentProps {
  apt: any;
  service: any;
  customer: any;
  displayEmps: any[];
  /** Pixel height of one 15-min slot (default 16px on mobile, 24px on desktop). */
  slotPx: number;
  /** Whether dragging is enabled (desktop). */
  draggable: boolean;
  /** Called for the mobile/fallback "move" button. */
  onRequestMove: (apt: any) => void;
}

export function DraggableAppointmentBlock({
  apt, service, customer, displayEmps, slotPx, draggable, onRequestMove,
}: DraggableAppointmentProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `apt-${apt.id}`,
    data: { appointmentId: apt.id, type: "appointment" },
    disabled: !draggable,
  });

  const duration = service?.duration_minutes || 30;
  const heightPx = Math.max(slotPx * 2, (duration / 15) * slotPx - 2);
  const color = service?.color || "#7B61FF";

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        height: `${heightPx}px`,
        backgroundColor: `${color}1F`,
        borderLeft: `3px solid ${color}`,
        opacity: isDragging ? 0.5 : 1,
        touchAction: "none",
      }}
      className={cn(
        "absolute left-1 right-1 top-0.5 rounded-xl p-2 transition-shadow",
        draggable && "hover:shadow-md",
      )}
    >
      <div className="flex items-start justify-between gap-1.5 h-full">
        <div className="flex items-start gap-1.5 min-w-0 flex-1 overflow-hidden">
          {displayEmps.length > 0 && (
            <div className="pt-0.5 shrink-0">
              <EmployeeAvatarStack employees={displayEmps} size="xs" max={2} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium truncate leading-tight">
              {customer?.name || "Klant"}
            </p>
            <p className="text-[10px] text-muted-foreground truncate leading-tight">
              {service?.name || ""}
            </p>
            <p className="text-[9px] text-muted-foreground flex items-center gap-0.5 mt-0.5">
              <Clock className="w-2.5 h-2.5" />
              {duration} min
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {draggable && (
            <button
              {...listeners}
              {...attributes}
              className="p-0.5 rounded hover:bg-secondary/60 cursor-grab active:cursor-grabbing"
              aria-label="Sleep om te verplaatsen"
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onRequestMove(apt); }}
            className="p-0.5 rounded hover:bg-secondary/60"
            aria-label="Verplaats afspraak"
            title="Verplaats afspraak"
          >
            <ArrowRightLeft className="w-3 h-3 text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface DropCellProps {
  employeeId: string | "unassigned";
  slot: string;
  slotPx: number;
  onClick?: () => void;
  isPause?: boolean;
}

export function DropCell({ employeeId, slot, slotPx, onClick, isPause }: DropCellProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-${employeeId}-${slot}`,
    data: { employeeId, slot, type: "slot" },
  });
  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      style={{ height: `${slotPx}px` }}
      className={cn(
        "border-t border-border/30 transition-colors",
        isOver && "bg-primary/15 ring-1 ring-primary/40",
        isPause && "bg-accent/40",
        onClick && "cursor-pointer hover:bg-primary/5",
      )}
    >
      {isPause && slot.endsWith(":00") && (
        <span className="text-[9px] text-muted-foreground pl-1">☕</span>
      )}
    </div>
  );
}

interface ColumnViewProps {
  employees: ColumnEmployee[];
  appointments: any[];
  services: any[];
  customers: any[];
  apptEmployees: any[];
  /** date string YYYY-MM-DD */
  date: string;
  /** function to compute display employees for an appointment (legacy + DB) */
  getDisplayEmployees: (apt: any) => any[];
  /** which DB employee owns this appointment (for grouping into columns).
   * Returns 'unassigned' when no match. */
  getColumnIdForAppointment: (apt: any) => string;
  /** check if a slot is a pause for this employee */
  isPauseSlot: (empId: string, slot: string) => boolean;
  onRequestMove: (apt: any) => void;
  onSlotClick: (empId: string, slot: string) => void;
  draggable: boolean;
}

const SLOT_PX = 18; // height per 15-min slot

export function EmployeeColumnDayView(props: ColumnViewProps) {
  const {
    employees, appointments, services, customers, apptEmployees,
    date, getDisplayEmployees, getColumnIdForAppointment,
    isPauseSlot, onRequestMove, onSlotClick, draggable,
  } = props;

  const columns: ColumnEmployee[] = [
    ...employees,
    { id: "unassigned", name: "Geen medewerker", color: "#94a3b8", photo_url: null },
  ];

  // Hour labels appear once per hour
  const hourSlots = fineSlots.filter(s => s.endsWith(":00"));

  const aptsForDate = appointments.filter(a => String(a.appointment_date).slice(0, 10) === date);

  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `48px repeat(${columns.length}, minmax(140px, 1fr))`, minWidth: `${48 + columns.length * 140}px` }}
      >
        {/* Header row */}
        <div />
        {columns.map(col => (
          <div key={col.id} className="text-xs font-medium text-center pb-1 border-b border-border">
            <div className="flex items-center justify-center gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: col.color || "#7B61FF" }}
              />
              <span className="truncate">{col.name}</span>
            </div>
          </div>
        ))}

        {/* Time labels column */}
        <div className="relative" style={{ height: `${fineSlots.length * SLOT_PX}px` }}>
          {hourSlots.map(slot => (
            <div
              key={slot}
              className="absolute left-0 right-0 text-[10px] text-muted-foreground tabular-nums"
              style={{ top: `${fineSlots.indexOf(slot) * SLOT_PX - 4}px` }}
            >
              {slot}
            </div>
          ))}
        </div>

        {/* Employee columns */}
        {columns.map(col => {
          const colAppts = aptsForDate.filter(a => getColumnIdForAppointment(a) === col.id);
          return (
            <div
              key={col.id}
              className="relative border-l border-border/30"
              style={{ height: `${fineSlots.length * SLOT_PX}px` }}
            >
              {fineSlots.map(slot => (
                <DropCell
                  key={slot}
                  employeeId={col.id}
                  slot={slot}
                  slotPx={SLOT_PX}
                  isPause={col.id !== "unassigned" && isPauseSlot(col.id, slot)}
                  onClick={() => onSlotClick(col.id, slot)}
                />
              ))}
              {/* Appointment blocks absolutely positioned */}
              {colAppts.map(apt => {
                const startTime = apt.start_time
                  ? String(apt.start_time).slice(0, 5)
                  : (String(apt.appointment_date).match(/T(\d{2}:\d{2})/)?.[1] || "09:00");
                const startMin = timeToMinutes(startTime);
                const startGridMin = timeToMinutes(fineSlots[0]);
                const top = ((startMin - startGridMin) / 15) * SLOT_PX;
                if (top < 0 || top > fineSlots.length * SLOT_PX) return null;
                const svc = services.find(s => s.id === apt.service_id);
                const cust = customers.find(c => c.id === apt.customer_id);
                const displayEmps = getDisplayEmployees(apt);
                return (
                  <div
                    key={apt.id}
                    className="absolute left-0 right-0 z-10"
                    style={{ top: `${top}px` }}
                  >
                    <DraggableAppointmentBlock
                      apt={apt}
                      service={svc}
                      customer={cust}
                      displayEmps={displayEmps}
                      slotPx={SLOT_PX}
                      draggable={draggable}
                      onRequestMove={onRequestMove}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
