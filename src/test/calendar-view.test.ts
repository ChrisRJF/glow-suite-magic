import { describe, it, expect } from "vitest";
import { appointmentDisplayDate, navStepDays, isSingleDayView } from "@/lib/calendarView";

describe("agenda navigation", () => {
  it("Dag and Per medewerker move 1 day, Week moves 7", () => {
    expect(navStepDays("day")).toBe(1);
    expect(navStepDays("columns")).toBe(1);
    expect(navStepDays("week")).toBe(7);
    expect(isSingleDayView("columns")).toBe(true);
    expect(isSingleDayView("week")).toBe(false);
  });
});

describe("calendar day of an appointment (fictional rows)", () => {
  it("new online booking just after midnight shows on the Amsterdam day", () => {
    expect(appointmentDisplayDate({ appointment_date: "2026-10-16T22:30:00+00:00", start_time: "00:30" })).toBe("2026-10-17");
    expect(appointmentDisplayDate({ appointment_date: "2026-10-13T08:00:00+00:00", start_time: "10:00:00" })).toBe("2026-10-13");
  });
  it("old agenda rows (wall clock as UTC) stay on their own day, also late evening", () => {
    expect(appointmentDisplayDate({ appointment_date: "2026-10-16T23:30:00+00:00", start_time: "23:30" })).toBe("2026-10-16");
    expect(appointmentDisplayDate({ appointment_date: "2026-10-13T10:00:00", start_time: "10:00" })).toBe("2026-10-13");
  });
  it("unclear or missing time is not guessed", () => {
    expect(appointmentDisplayDate({ appointment_date: "2026-10-13T09:00:00+00:00", start_time: "15:00" })).toBe("2026-10-13");
    expect(appointmentDisplayDate({ appointment_date: "2026-10-13T22:30:00+00:00" })).toBe("2026-10-13");
  });
});
