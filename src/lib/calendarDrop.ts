import { pointerWithin, rectIntersection, type CollisionDetection } from "@dnd-kit/core";
import { fineSlots, timeToMinutes, snapToFine, SNAP_MINUTES } from "@/lib/agendaMove";

export interface DropData {
  slot?: string;
  employeeId?: string;
  type?: string;
}

export interface ResolvedDrop {
  time: string;
  employeeId: string | null;
}

/**
 * Turn dnd-kit `over.data` into a move target. Returns null (= noop) when the
 * drop did not land on a slot. In day view the current employee is kept; in
 * column view the column's employee ID is used (never a name lookup).
 */
export function resolveDropTarget(
  over: DropData | null | undefined,
  view: "day" | "columns" | string,
  currentColumnId: string,
): ResolvedDrop | null {
  if (!over?.slot) return null;
  const time = snapToFine(over.slot);
  if (view === "columns") {
    const id = over.employeeId;
    if (!id) return null;
    return { time, employeeId: id === "unassigned" ? null : id };
  }
  return { time, employeeId: currentColumnId === "unassigned" ? null : currentColumnId };
}

/**
 * Checks that the full appointment duration fits in the agenda grid and does
 * not overlap a pause of the target employee. Appointment overlap is checked
 * separately by the shared findConflict().
 */
export function validateDropWindow(args: {
  time: string;
  durationMinutes: number;
  isPause?: (slot: string) => boolean;
}): string | null {
  const first = timeToMinutes(fineSlots[0]);
  const gridEnd = timeToMinutes(fineSlots[fineSlots.length - 1]) + SNAP_MINUTES;
  const start = timeToMinutes(args.time);
  const end = start + args.durationMinutes;
  if (start < first || end > gridEnd) {
    return "Deze tijd valt buiten de agenda. Kies een andere plek.";
  }
  if (args.isPause) {
    for (let m = start; m < end; m += SNAP_MINUTES) {
      const h = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      if (args.isPause(`${h}:${mm}`)) {
        return "Deze tijd valt in een pauze. Kies een andere plek.";
      }
    }
  }
  return null;
}

/** True when the drag started from a touch gesture (phone/tablet). */
export function isTouchActivation(ev: Event | null | undefined): boolean {
  if (!ev) return false;
  if (typeof TouchEvent !== "undefined" && ev instanceof TouchEvent) return true;
  const pt = (ev as PointerEvent).pointerType;
  return pt === "touch" || pt === "pen";
}

/**
 * Collision detection for the agenda: the slot under the finger/cursor wins.
 * Falls back to rect intersection (keyboard drags have no pointer).
 * Needed because the day-view draggable wrapper has zero height and a long
 * appointment fully overlaps several 15-min cells, which made plain rect
 * intersection pick no slot or a slot 15 minutes off.
 */
export const agendaCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};
