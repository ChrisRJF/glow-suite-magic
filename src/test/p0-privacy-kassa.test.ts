import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const booking = readFileSync("supabase/functions/public-booking/index.ts", "utf8");
const kassa = readFileSync("src/pages/KassaPage.tsx", "utf8");

describe("P0 public lookup privacy", () => {
  it("lookup_customer always answers empty, never reads customers", () => {
    const block = booking.slice(booking.indexOf('action === "lookup_customer"'), booking.indexOf("const data = parsed.data;"));
    expect(block).toContain("customer: null, recentAppointments: []");
    expect(block).not.toContain('from("customers")');
    expect(block).not.toContain('from("appointments")');
  });
});

describe("P0 Kassa payment registration", () => {
  it("no button triggers the direct paid registration", () => {
    expect(kassa).not.toContain("onClick={handlePay}");
  });
});
