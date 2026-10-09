import { describe, it, expect } from "vitest";
import { matchCustomer, parseDate, fingerprintSource, autoMap } from "@/lib/historicalImport";

const cs = [
  { id: "a", name: "Eva Test", email: "eva@test.nl", phone: "0612345678" },
  { id: "b", name: "Eva Test", email: "eva2@test.nl", phone: null },
  { id: "c", name: "Rob Proef", email: null, phone: "+31687654321" },
];

describe("historical import matching", () => {
  it("links automatically on unique e-mail", () => {
    expect(matchCustomer({ email: "EVA@test.nl" }, cs)).toEqual({ status: "matched", customerId: "a", via: "email" });
  });
  it("links automatically on unique phone", () => {
    expect(matchCustomer({ phone: "06 87654321" }, cs)).toMatchObject({ status: "matched", customerId: "c" });
  });
  it("never links on name only", () => {
    expect(matchCustomer({ name: "Rob Proef" }, cs).status).toBe("check");
  });
  it("conflicting e-mail and phone requires review", () => {
    expect(matchCustomer({ email: "eva2@test.nl", phone: "0612345678" }, cs).status).toBe("check");
  });
  it("unknown customer is not linked", () => {
    expect(matchCustomer({ name: "Niemand" }, cs).status).toBe("none");
  });
});

describe("historical import parsing", () => {
  it("keeps the original date and rejects impossible dates", () => {
    expect(parseDate("03-02-2024")).toBe("2024-02-03");
    expect(parseDate("31-02-2024")).toBeNull();
  });
  it("same row yields same fingerprint", () => {
    const v = { date: "2024-02-03", service: "Peeling", note: "Rustig  verlopen" };
    expect(fingerprintSource("treatment_note", "a", v)).toBe(fingerprintSource("treatment_note", "a", { ...v, note: "Rustig verlopen" }));
  });
  it("maps flexible column names", () => {
    expect(autoMap("treatment_note", ["Klantnaam", "Behandeldatum", "Verslag"])).toMatchObject({ customer_name: "Klantnaam", date: "Behandeldatum", note: "Verslag" });
  });
});
