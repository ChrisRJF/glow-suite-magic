import { describe, it, expect } from "vitest";
import { findDuplicateGroups, normalizePhone, searchAfterUpdate, type DupCustomer } from "@/lib/customerDuplicates";

const mk = (i: number, o: Partial<DupCustomer> = {}): DupCustomer => ({
  id: `c-${String(i).padStart(5, "0")}`, name: `Fictief ${i}`, email: `fictief${i}@voorbeeld.test`,
  phone: `06${String(10000000 + i)}`, created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`, ...o,
});

describe("rename keeps customer visible", () => {
  it("switches search to the new name when old search no longer matches", () => {
    expect(searchAfterUpdate("Zoë", { name: "Anna Fictief" })).toBe("Anna Fictief");
  });
  it("keeps the search when it still matches", () => {
    expect(searchAfterUpdate("fictief", { name: "Anna Fictief" })).toBe("fictief");
    expect(searchAfterUpdate("", { name: "X" })).toBe("");
  });
});

describe("duplicate detection", () => {
  it("normalises Dutch phone formats", () => {
    expect(normalizePhone("06-12345678")).toBe("31612345678");
    expect(normalizePhone("+31 6 1234 5678")).toBe("31612345678");
    expect(normalizePhone("0031612345678")).toBe("31612345678");
    expect(normalizePhone("+31 (0)6 12345678")).toBe("31612345678");
    expect(normalizePhone("123")).toBeNull();
  });

  it("same name only is not a duplicate", () => {
    expect(findDuplicateGroups([mk(1, { name: "Sam" }), mk(2, { name: "Sam" })])).toHaveLength(0);
  });

  it("finds duplicates in 2.500 imported records by email (case) and phone (format)", () => {
    const list = Array.from({ length: 2500 }, (_, i) => mk(i));
    list.push(mk(9001, { email: "FICTIEF5@voorbeeld.test", phone: null }));          // email dup of 5
    list.push(mk(9002, { email: null, phone: "+31 6 1000 0010" }));                  // phone dup of 10
    list.push(mk(9003, { email: "fictief10@voorbeeld.test", phone: null }));         // chains to 10 group
    list.push(mk(9004, { name: "Fictief 20", email: null, phone: null }));          // name only: ignored
    const groups = findDuplicateGroups(list);
    expect(groups).toHaveLength(2);
    const g10 = groups.find((g) => g.customers.some((c) => c.id === "c-00010"))!;
    expect(g10.customers.map((c) => c.id).sort()).toEqual(["c-00010", "c-09002", "c-09003"]);
    expect(g10.suggestedKeepId).toBe("c-00010");
    const g5 = groups.find((g) => g.customers.some((c) => c.id === "c-00005"))!;
    expect(g5.customers).toHaveLength(2);
    expect(groups.flatMap((g) => g.customers).some((c) => c.id === "c-09004")).toBe(false);
  });
});
