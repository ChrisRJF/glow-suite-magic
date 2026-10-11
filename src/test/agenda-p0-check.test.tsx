import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { findConflict } from "@/lib/agendaMove";
import { EmployeeColumnDayView } from "@/components/EmployeeColumnDayView";

const services = [{ id: "s60", duration_minutes: 60, name: "Behandeling" }];
const links = [{ appointment_id: "mid", employee_id: "emp-a" }, { appointment_id: "old", employee_id: "emp-a" }];
// Fictional: online booking 00:30 Amsterdam on 17 Oct (stored UTC 16 Oct 22:30) and an old row 16 Oct 23:30.
const appts = [
  { id: "mid", appointment_date: "2026-10-16T22:30:00+00:00", start_time: "00:30", end_time: "01:30", service_id: "s60", notes: "" },
  { id: "old", appointment_date: "2026-10-16T23:30:00+00:00", start_time: "23:30", end_time: "23:59", service_id: "s60", notes: "" },
];
const base = { movingId: "x", durationMinutes: 60, targetEmployeeName: null, appointments: appts, apptEmployees: links, services };

describe("move conflict check uses the Dutch calendar day", () => {
  it("midnight online booking conflicts on 17 Oct, not on 16 Oct", () => {
    expect(findConflict({ ...base, date: "2026-10-17", startTime: "00:00", targetEmployeeId: "emp-a" })).toMatch(/00:30/);
    expect(findConflict({ ...base, date: "2026-10-16", startTime: "00:00", targetEmployeeId: "emp-a" })).toBeNull();
  });
  it("old row keeps its own day; other employee is free", () => {
    expect(findConflict({ ...base, date: "2026-10-16", startTime: "23:00", targetEmployeeId: "emp-a" })).toMatch(/23:30/);
    expect(findConflict({ ...base, date: "2026-10-16", startTime: "23:00", targetEmployeeId: "emp-b" })).toBeNull();
  });
  it("moving an appointment onto its own slot is not a conflict", () => {
    expect(findConflict({ ...base, movingId: "old", date: "2026-10-16", startTime: "23:30", targetEmployeeId: "emp-a" })).toBeNull();
  });
});

describe("Per medewerker view (fictional)", () => {
  it("shows every working employee, also without appointments, and each appointment once", () => {
    const day = [{ id: "a1", appointment_date: "2026-10-13T10:00:00", start_time: "10:00", end_time: "11:00", service_id: "s60", customer_id: "c1", notes: "", status: "gepland" }];
    render(<EmployeeColumnDayView
      employees={[{ id: "emp-a", name: "Fictief Anna", color: "#888", photo_url: null }, { id: "emp-b", name: "Fictief Bas", color: "#888", photo_url: null }]}
      appointments={day} services={services} customers={[{ id: "c1", name: "Klant Fictief" }]}
      apptEmployees={[{ appointment_id: "a1", employee_id: "emp-a" }]} date="2026-10-13"
      getDisplayEmployees={() => []} getColumnIdForAppointment={() => "emp-a"} isPauseSlot={() => false}
      onRequestMove={vi.fn()} onSlotClick={vi.fn()} draggable={false} />);
    expect(screen.getByText("Fictief Anna")).toBeInTheDocument();
    expect(screen.getByText("Fictief Bas")).toBeInTheDocument();
    expect(screen.getAllByText("Klant Fictief")).toHaveLength(1);
  });
});
