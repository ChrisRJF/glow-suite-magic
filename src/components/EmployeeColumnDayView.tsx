import { useDraggable, useDroppable } from "@dnd-kit/core";
import { appointmentDisplayDate } from "@/lib/calendarView";
import { CSS } from "@dnd-kit/utilities";
import { Clock, GripVertical, ArrowRightLeft } from "lucide-react";
import { EmployeeAvatarStack } from "@/components/EmployeeAvatar";
import { cn } from "@/lib/utils";
import { fineSlots, timeToMinutes } from "@/lib/agendaMove";
import { useEffect, useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { noteStaffName, staffColors, staffLabels } from "@/lib/agendaStaff";

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
  /** Opens the same appointment details as the day view. */
  onOpen?: (apt: any) => void;
  /** Staff color (left border); the service color stays as a small dot. */
  accentColor?: string;
  /** Shown when the appointment has no linked employee but old notes name someone. */
  noteName?: string | null;
}

export function DraggableAppointmentBlock({
  apt, service, customer, displayEmps, slotPx, draggable, onRequestMove, onOpen, accentColor, noteName,
}: DraggableAppointmentProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `apt-${apt.id}`,
    data: { appointmentId: apt.id, type: "appointment" },
    disabled: !draggable,
  });

  const duration = service?.duration_minutes || 30;
  const heightPx = Math.max(slotPx * 2, (duration / 15) * slotPx - 2);
  const svcColor = service?.color || "#7B61FF";
  const color = accentColor || svcColor;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        height: `${heightPx}px`,
        backgroundColor: `${color}1F`,
        borderLeft: `3px solid ${color}`,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 50 : undefined,
        // touch-action stays default here so the agenda can still be swiped;
        // only the grip below blocks native scrolling.
      }}
      data-apt-id={apt.id}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? `Open afspraak ${customer?.name || "Klant"}` : undefined}
      onClick={onOpen ? () => onOpen(apt) : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(apt); } } : undefined}
      className={cn(
        "absolute left-1 right-1 top-0.5 rounded-xl p-2 transition-shadow",
        (draggable || onOpen) && "hover:shadow-md",
        onOpen && "cursor-pointer",
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
            <p className="text-[10px] text-muted-foreground truncate leading-tight flex items-center gap-1">
              {accentColor && <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: svcColor }} />}
              {service?.name || ""}
            </p>
            {noteName && (
              <p className="text-[9px] text-muted-foreground truncate leading-tight">Notitie: {noteName} (niet gekoppeld)</p>
            )}
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
              className="h-11 w-11 rounded-lg bg-background/60 hover:bg-secondary/60 cursor-grab active:cursor-grabbing flex items-center justify-center"
              aria-label="Sleep om te verplaatsen"
              title="Houd vast en sleep om te verplaatsen"
              onClick={(e) => e.stopPropagation()}
              style={{ touchAction: "none", WebkitTouchCallout: "none", userSelect: "none" }}
            >
              <GripVertical className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onRequestMove(apt); }}
            className="min-h-9 min-w-9 rounded hover:bg-secondary/60 flex items-center justify-center"
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
        isPause && "bg-muted/70",
        onClick && "cursor-pointer hover:bg-primary/5",
      )}
    >
      {isPause && slot.endsWith(":00") && (
        <span className="text-[9px] text-muted-foreground pl-1 select-none">Pauze</span>
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
  /** Opens the same appointment details as the day view. */
  onOpenAppointment?: (apt: any) => void;
  /** Opens the review list for appointments without a linked employee. */
  onReviewUnassigned?: () => void;
}

const SLOT_PX_DESKTOP = 18;
const SLOT_PX_MOBILE = 28;

export function EmployeeColumnDayView(props: ColumnViewProps) {
  const {
    employees, appointments, services, customers, apptEmployees,
    date, getDisplayEmployees, getColumnIdForAppointment,
    isPauseSlot, onRequestMove, onSlotClick, draggable, onOpenAppointment, onReviewUnassigned,
  } = props;
  const isMobile = useIsMobile();
  const SLOT_PX = isMobile ? SLOT_PX_MOBILE : SLOT_PX_DESKTOP;

  const labels = useMemo(() => staffLabels(employees), [employees]);
  const colors = useMemo(() => staffColors(employees), [employees]);
  const allColumns: ColumnEmployee[] = [
    ...employees.map((e) => ({ ...e, name: labels.get(e.id) || e.name, color: colors.get(e.id) || e.color })),
  ];

  // Hour labels appear once per hour
  const hourSlots = fineSlots.filter(s => s.endsWith(":00"));

  const aptsForDate = appointments.filter(a => appointmentDisplayDate(a) === date);
  const countFor = (id: string) => aptsForDate.filter(a => getColumnIdForAppointment(a) === id).length;
  // Only real staff are columns; unlinked appointments go to a review list.
  const switchable = allColumns;
  const unassignedCount = countFor("unassigned");
  const [mobileCol, setMobileCol] = useState<string>("");
  useEffect(() => {
    if (!switchable.some(c => c.id === mobileCol)) setMobileCol(switchable[0]?.id || "");
  }, [switchable.map(c => c.id).join(","), mobileCol]); // eslint-disable-line react-hooks/exhaustive-deps
  const columns = isMobile ? allColumns.filter(c => c.id === (mobileCol || switchable[0]?.id)) : allColumns;

  return (
    <div className={cn(!isMobile && "overflow-x-auto -mx-2 px-2")}>
      {unassignedCount > 0 && (
        <div role="status" className="mb-2 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <span className="flex-1">{unassignedCount} {unassignedCount === 1 ? "afspraak" : "afspraken"} zonder medewerker op deze dag</span>
          {onReviewUnassigned && (
            <button type="button" onClick={onReviewUnassigned} className="h-9 px-3 rounded-lg bg-background border border-border font-medium">Bekijken</button>
          )}
        </div>
      )}
      {allColumns.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">Nog geen medewerkers. Voeg ze toe bij Medewerkers.</p>}
      {isMobile && (
        <div role="group" aria-label="Kies medewerker" className="flex gap-1.5 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
          {switchable.map(c => (
            <button key={c.id} type="button" aria-pressed={c.id === columns[0]?.id} onClick={() => setMobileCol(c.id)}
              className={cn("shrink-0 h-9 px-3 rounded-full border text-xs font-medium flex items-center gap-1.5",
                c.id === columns[0]?.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground")}>
              <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color || "#7B61FF" }} />
              {c.name}<span className="text-[10px] text-muted-foreground">{countFor(c.id)}</span>
            </button>
          ))}
        </div>
      )}
      <div
        className="grid gap-1"
        style={isMobile
          ? { gridTemplateColumns: `40px minmax(0, 1fr)` }
          : { gridTemplateColumns: `48px repeat(${columns.length}, minmax(140px, 1fr))`, minWidth: `${48 + columns.length * 140}px` }}
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
                      onOpen={onOpenAppointment}
                      accentColor={col.id === "unassigned" ? undefined : (col.color || undefined)}
                      noteName={col.id === "unassigned" ? noteStaffName(apt.notes) : null}
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
