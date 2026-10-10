import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type React from "react";
import { cn } from "@/lib/utils";

/** Draggable wrapper for a day-view appointment. Hoisted out of CalendarPage
 * so it keeps its identity across renders (no remount mid-drag). */
export function DayApptDraggable({ apt, children }: { apt: any; children: (handleProps: any) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `day-apt-${apt.id}`,
    data: { appointmentId: apt.id, type: "appointment" },
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 50 : undefined,
      }}
      className="absolute inset-x-0 top-1"
    >
      {children({ attributes, listeners })}
    </div>
  );
}

/** Drop layer for one day-view half-hour row. Present on every row (also
 * occupied/pause rows) so a drop always gets feedback via the shared checks. */
export function DaySlotDroppable({ slot, children }: { slot: string; children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day-slot-${slot}`,
    data: { slot, employeeId: undefined, type: "slot" },
  });
  return (
    <div
      ref={setNodeRef}
      data-drop-slot={slot}
      data-over={isOver ? "true" : undefined}
      className={cn("absolute inset-0 transition-colors rounded-xl", isOver && "bg-primary/15 ring-2 ring-primary/50")}
    >
      {children}
    </div>
  );
}
