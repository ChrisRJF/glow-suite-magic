import { describe, it, expect } from "vitest";
import { amsterdamDateKey } from "@/lib/reporting";
import { nextDateKey, safeAmsterdamDateKey } from "@/lib/calendarWeek";

describe("dashboard vandaag/morgen in Nederlandse tijd", () => {
  it("00:30 Amsterdam is al de nieuwe dag, terwijl UTC nog gisteren is", () => {
    const now = new Date("2026-10-10T22:30:00Z"); // zo 11 okt 00:30 CEST
    expect(now.toISOString().slice(0, 10)).toBe("2026-10-10");
    expect(amsterdamDateKey(now)).toBe("2026-10-11");
  });
  it("afspraak om 01:00 Amsterdam hoort bij die Amsterdamse dag", () => {
    expect(safeAmsterdamDateKey("2026-10-10T23:00:00+00:00")).toBe("2026-10-11");
  });
  it("betaling aangemaakt 23:30 Amsterdam blijft op dezelfde dag", () => {
    expect(safeAmsterdamDateKey("2026-10-11T21:30:00Z")).toBe("2026-10-11");
  });
  it("volgende dag over wintertijd (25 okt) en zomertijd (29 mrt)", () => {
    expect(nextDateKey("2026-10-24")).toBe("2026-10-25");
    expect(nextDateKey("2026-10-25")).toBe("2026-10-26");
    expect(nextDateKey("2027-03-27")).toBe("2027-03-28");
    expect(nextDateKey("2027-03-28")).toBe("2027-03-29");
    expect(nextDateKey("2026-12-31")).toBe("2027-01-01");
  });
  it("na wintertijd: 23:30 CET op 25 okt valt op 25 okt", () => {
    expect(safeAmsterdamDateKey("2026-10-25T22:30:00Z")).toBe("2026-10-25");
  });
  it("ontbrekende of ongeldige datum geeft null, geen crash", () => {
    expect(safeAmsterdamDateKey(null)).toBeNull();
    expect(safeAmsterdamDateKey("ongeldig")).toBeNull();
  });
});
