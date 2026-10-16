import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { staffColors, staffLabels, noteStaffName } from "@/lib/agendaStaff";
import { EmployeeColumnDayView } from "@/components/EmployeeColumnDayView";

const two = [{ id: "t1", name: "Tino", role: "Barber", color: "#7B61FF" }, { id: "t2", name: "Tino", role: "Barber", color: "#7B61FF" }];

describe("agenda staff (fictional)", () => {
  it("same names get distinct labels by ID", () => {
    const l = staffLabels(two);
    expect(l.get("t1")).toBe("Tino (1)");
    expect(l.get("t2")).toBe("Tino (2)");
  });
  it("same colors are made distinct", () => {
    const c = staffColors(two);
    expect(c.get("t1")).toBe("#7B61FF");
    expect(c.get("t2")).not.toBe("#7B61FF");
  });
  it("note names are text only", () => {
    expect(noteStaffName("Medewerker: Roos")).toBe("Roos");
    expect(noteStaffName("Medewerker: Niet toegewezen")).toBeNull();
  });
  it("unlinked appointment is not a staff column; review list is offered", () => {
    const onOpen = vi.fn(); const onReview = vi.fn();
    const apt = { id: "a1", appointment_date: "2026-10-13T10:00:00", start_time: "10:00", service_id: "s", customer_id: "c", notes: "Medewerker: Roos" };
    render(<EmployeeColumnDayView employees={two} appointments={[apt]} services={[{ id: "s", duration_minutes: 30, name: "Knippen" }]}
      customers={[{ id: "c", name: "Klant Fictief" }]} apptEmployees={[]} date="2026-10-13" getDisplayEmployees={() => []}
      getColumnIdForAppointment={() => "unassigned"} isPauseSlot={() => false} onRequestMove={vi.fn()} onSlotClick={vi.fn()}
      draggable={false} onOpenAppointment={onOpen} onReviewUnassigned={onReview} />);
    expect(screen.getByText("Tino (1)")).toBeInTheDocument();
    expect(screen.getByText("Tino (2)")).toBeInTheDocument();
    expect(screen.queryByText("Geen medewerker")).toBeNull();
    expect(screen.queryByText("Klant Fictief")).toBeNull();
    expect(screen.getByText("1 afspraak zonder medewerker op deze dag")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bekijken" }));
    expect(onReview).toHaveBeenCalled();
  });
  it("linked appointment opens details on click", () => {
    const onOpen = vi.fn();
    const apt = { id: "a2", appointment_date: "2026-10-13T10:00:00", start_time: "10:00", service_id: "s", customer_id: "c", notes: "" };
    render(<EmployeeColumnDayView employees={two} appointments={[apt]} services={[{ id: "s", duration_minutes: 30, name: "Knippen" }]}
      customers={[{ id: "c", name: "Klant Fictief" }]} apptEmployees={[]} date="2026-10-13" getDisplayEmployees={() => []}
      getColumnIdForAppointment={() => "t2"} isPauseSlot={() => false} onRequestMove={vi.fn()} onSlotClick={vi.fn()}
      draggable={false} onOpenAppointment={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /Open afspraak Klant Fictief/ }));
    expect(onOpen).toHaveBeenCalledWith(apt);
  });
});
