import { describe, it, expect } from "vitest";
import { amsterdamWeekBounds, countNewCustomersThisWeek } from "@/lib/calendarWeek";

describe("nieuwe klanten deze kalenderweek (Europe/Amsterdam)", () => {
  it("week loopt van maandag tot en met zondag", () => {
    // za 10 okt 2026
    expect(amsterdamWeekBounds(new Date("2026-10-10T12:00:00Z"))).toEqual({ monday: "2026-10-05", sunday: "2026-10-11" });
  });

  it("zondagavond laat in Amsterdam hoort nog bij dezelfde week", () => {
    // zo 11 okt 23:30 Amsterdam = 21:30 UTC
    expect(amsterdamWeekBounds(new Date("2026-10-11T21:30:00Z")).monday).toBe("2026-10-05");
  });

  it("maandag 00:30 Amsterdam (nog zondag in UTC) start een nieuwe week", () => {
    expect(amsterdamWeekBounds(new Date("2026-10-11T22:30:00Z")).monday).toBe("2026-10-12");
  });

  it("telt alleen klanten van ma t/m zo, ook rond de grenzen", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const customers = [
      { created_at: "2026-10-04T21:59:00Z" }, // zo 4 okt 23:59 Amsterdam, vorige week
      { created_at: "2026-10-04T22:01:00Z" }, // ma 5 okt 00:01 Amsterdam
      { created_at: "2026-10-08T10:00:00Z" },
      { created_at: "2026-10-11T21:59:00Z" }, // zo 11 okt 23:59
      { created_at: "2026-10-11T22:01:00Z" }, // ma 12 okt
      { created_at: "2026-09-20T10:00:00Z" }, // eerder deze maand-achtig, niet deze week
      { created_at: null },
      { created_at: "ongeldig" },
    ];
    expect(countNewCustomersThisWeek(customers, now)).toBe(3);
  });

  it("week over de wintertijdovergang (25 okt 2026)", () => {
    const now = new Date("2026-10-25T12:00:00Z");
    expect(amsterdamWeekBounds(now)).toEqual({ monday: "2026-10-19", sunday: "2026-10-25" });
    expect(countNewCustomersThisWeek([{ created_at: "2026-10-25T22:30:00Z" }], now)).toBe(1); // zo 23:30 CET
  });

  it("lege salon geeft 0", () => {
    expect(countNewCustomersThisWeek([], new Date())).toBe(0);
  });
});
