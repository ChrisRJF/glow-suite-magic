// Helpers for moving / rescheduling appointments on the agenda.
// Pure functions kept separate so CalendarPage stays focused on rendering.

export const SNAP_MINUTES = 15;

// 15-minute slot grid used for drop targets and snapping.
export const fineSlots: string[] = (() => {
  const out: string[] = [];
  for (let h = 9; h <= 18; h++) {
    for (let m = 0; m < 60; m += SNAP_MINUTES) {
      if (h === 18 && m > 0) break; // stop at 18:00
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return out;
})();

export const timeToMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const minutesToTime = (mins: number): string => {
  const total = Math.max(0, mins);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export const snapToFine = (t: string): string => {
  const m = timeToMinutes(t);
  const snapped = Math.round(m / SNAP_MINUTES) * SNAP_MINUTES;
  return minutesToTime(snapped);
};

export interface ConflictCheckArgs {
  /** appointment id we are moving (to exclude from conflict scan) */
  movingId: string;
  /** target date (YYYY-MM-DD) */
  date: string;
  /** target start HH:MM */
  startTime: string;
  /** target duration in minutes */
  durationMinutes: number;
  /** target employee id (DB) — may be null for unassigned/legacy */
  targetEmployeeId: string | null;
  /** target employee name (used for legacy notes match) */
  targetEmployeeName: string | null;
  /** all appointments */
  appointments: any[];
  /** appointment_employees join rows */
  apptEmployees: any[];
  /** services list (for duration lookup) */
  services: any[];
}

const getApptDate = (a: any) => String(a.appointment_date).slice(0, 10);
const getApptStart = (a: any): string => {
  if (a.start_time) return String(a.start_time).slice(0, 5);
  const m = String(a.appointment_date).match(/T(\d{2}:\d{2})/);
  return m?.[1] || '00:00';
};
const getApptEnd = (a: any, services: any[]): string => {
  if (a.end_time) return String(a.end_time).slice(0, 5);
  const svc = services.find(s => s.id === a.service_id);
  const dur = svc?.duration_minutes || 30;
  return minutesToTime(timeToMinutes(getApptStart(a)) + dur);
};

/** Returns a human conflict message, or null if no conflict. */
export const findConflict = (args: ConflictCheckArgs): string | null => {
  const {
    movingId, date, startTime, durationMinutes,
    targetEmployeeId, targetEmployeeName,
    appointments, apptEmployees, services,
  } = args;

  const startMin = timeToMinutes(startTime);
  const endMin = startMin + durationMinutes;

  for (const a of appointments) {
    if (a.id === movingId) continue;
    if (getApptDate(a) !== date) continue;
    const aStart = timeToMinutes(getApptStart(a));
    const aEnd = timeToMinutes(getApptEnd(a, services));
    const overlaps = aStart < endMin && aEnd > startMin;
    if (!overlaps) continue;

    // Same employee?
    let sameEmployee = false;
    if (targetEmployeeId) {
      sameEmployee = apptEmployees.some(
        l => l.appointment_id === a.id && l.employee_id === targetEmployeeId
      );
    }
    if (!sameEmployee && targetEmployeeName) {
      const note = String(a.notes || '');
      if (note.includes(`Medewerker: ${targetEmployeeName}`)) sameEmployee = true;
    }
    if (sameEmployee) {
      return `Conflict met afspraak om ${getApptStart(a)}`;
    }
  }
  return null;
};
