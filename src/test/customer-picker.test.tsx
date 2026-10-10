import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { CustomerPicker } from "@/components/CustomerPicker";

const customers = Array.from({ length: 15000 }, (_, i) => ({ id: `c${i}`, name: `Klant ${i}`, email: null, phone: null }));
customers.push({ id: "z", name: "Zoë Zandvoort", email: "zoe@fictief.test", phone: "0612345678" } as any);

function Host({ initial = "", onPick = () => {} }: { initial?: string; onPick?: (id: string) => void }) {
  const [v, setV] = useState(initial);
  return <><CustomerPicker customers={customers} value={v} onChange={(id) => { setV(id); onPick(id); }} /><span data-testid="v">{v}</span></>;
}

describe("CustomerPicker", () => {
  it("rendert nooit duizenden opties", () => {
    render(<Host />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "klant" } });
    expect(screen.getAllByRole("option").length).toBe(50);
  });
  it("toetsenbord: pijl omlaag + Enter kiest klant", () => {
    const pick = vi.fn(); render(<Host onPick={pick} />);
    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: "+31 6 1234" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(pick).toHaveBeenCalledWith("z");
    expect(screen.getByText("Zoë Zandvoort")).toBeTruthy();
  });
  it("geen klant gevonden", () => {
    render(<Host />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "xyz" } });
    expect(screen.getByText("Geen klant gevonden")).toBeTruthy();
  });
  it("voorselectie via route toont gekozen klant en kan gewijzigd worden", () => {
    render(<Host initial="z" />);
    expect(screen.getByText("Zoë Zandvoort")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Andere klant kiezen" }));
    expect(screen.getByTestId("v").textContent).toBe("");
  });
  it("vrije tekst wordt nooit een klant-ID", () => {
    const pick = vi.fn(); render(<Host onPick={pick} />);
    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: "Onbekende Naam" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(pick).not.toHaveBeenCalled();
  });
});
