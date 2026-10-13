import { describe, it, expect } from "vitest";
import { appointmentDisplayDate, navStepDays, isSingleDayView, weekDaysFor } from "@/lib/calendarView";

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

describe("week of a picked date", () => {
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  it("13, 19 and 28 Oct 2026 land in their Mon-Sun week", () => {
    expect(weekDaysFor(new Date(2026, 9, 13)).map(ymd)).toEqual(["2026-10-12","2026-10-13","2026-10-14","2026-10-15","2026-10-16","2026-10-17","2026-10-18"]);
    expect(ymd(weekDaysFor(new Date(2026, 9, 19))[0])).toBe("2026-10-19");
    expect(ymd(weekDaysFor(new Date(2026, 9, 28))[0])).toBe("2026-10-26");
  });
  it("a Sunday is part of its own week", () => {
    expect(weekDaysFor(new Date(2026, 9, 18)).map(ymd)).toContain("2026-10-18");
  });
  it("week across the month border (1 Nov 2026)", () => {
    const w = weekDaysFor(new Date(2026, 10, 1)).map(ymd);
    expect(w[0]).toBe("2026-10-26"); expect(w[6]).toBe("2026-11-01");
  });
});
