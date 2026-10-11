import { describe, it, expect } from "vitest";
import { filterCustomerList } from "@/lib/customerSearch";
import { searchAfterUpdate } from "@/lib/customerDuplicates";
import { fetchAllRows } from "@/lib/fetchAllRows";

// 15.500 fictional customers, sorted by name like the page.
const N = 15500;
const all = Array.from({ length: N }, (_, i) => ({
  id: `id-${i}`,
  name: `Klant ${String(i).padStart(5, "0")}`,
  email: `klant${i}@voorbeeld.test`,
  phone: `06${String(10000000 + i)}`,
}));
all[14321] = { id: "id-14321", name: "Anna José van Dijk", email: "anna@voorbeeld.test", phone: "+31 6 9999 0000" };

describe("customer list search over 15k+ fictional customers", () => {
  it("loads every row past page 1 and page 1000", async () => {
    const { data } = await fetchAllRows(async (from, to) => ({ data: all.slice(from, to + 1), error: null }));
    expect(data.length).toBe(N);
  });
  it("finds a match far beyond the first 100 and 1000", () => {
    expect(filterCustomerList(all, "klant 15499").map(c => c.id)).toEqual(["id-15499"]);
    expect(filterCustomerList(all, "van dijk").map(c => c.id)).toEqual(["id-14321"]);
  });
  it("word order, case and accents do not matter", () => {
    for (const q of ["dijk anna", "JOSE", "  anna   van  dijk "]) {
      expect(filterCustomerList(all, q).map(c => c.id)).toEqual(["id-14321"]);
    }
  });
  it("Dutch phone variants match", () => {
    for (const q of ["0699990000", "06 9999 0000", "+31699990000"]) {
      expect(filterCustomerList(all, q).map(c => c.id)).toContain("id-14321");
    }
  });
  it("empty search returns all, no hidden limit", () => {
    expect(filterCustomerList(all, "").length).toBe(N);
    expect(filterCustomerList(all, "klant").length).toBe(N - 1);
  });
  it("adding a surname keeps the same customer findable by the new name", () => {
    const edited = { ...all[200], name: "Klant 00200 Jansen" };
    const list = all.map(c => (c.id === edited.id ? edited : c));
    expect(searchAfterUpdate("00200", edited)).toBe("00200");
    expect(filterCustomerList(list, "jansen").map(c => c.id)).toEqual(["id-200"]);
    expect(list.length).toBe(N);
  });
});
