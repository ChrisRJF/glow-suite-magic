import { describe, it, expect } from "vitest";
import { pageCount, clampPage, pageSlice, pageRange, visiblePages, pageOfId } from "@/lib/customerPagination";
import { filterCustomerList } from "@/lib/customerSearch";

const make = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `id-${i}`, name: `Fictief ${String(i).padStart(4, "0")}`, email: `f${i}@voorbeeld.test`, phone: `06${10000000 + i}`,
}));

describe("customer pagination (25 per page)", () => {
  it.each([[0, 0], [9, 1], [25, 1], [26, 2], [100, 4], [250, 10], [1500, 60]])("%i customers -> %i pages", (n, p) => {
    expect(pageCount(n)).toBe(p);
  });
  it("ranges and boundaries", () => {
    expect(pageRange(1, 250)).toEqual({ from: 1, to: 25 });
    expect(pageRange(10, 250)).toEqual({ from: 226, to: 250 });
    expect(pageRange(2, 26)).toEqual({ from: 26, to: 26 });
    expect(pageRange(1, 9)).toEqual({ from: 1, to: 9 });
    expect(pageRange(1, 0)).toEqual({ from: 0, to: 0 });
  });
  it("page switch slices the right customers", () => {
    const list = make(250);
    expect(pageSlice(list, 3).map(c => c.id)[0]).toBe("id-50");
    expect(pageSlice(list, 3).length).toBe(25);
    expect(pageSlice(make(26), 2).map(c => c.id)).toEqual(["id-25"]);
  });
  it("clamps when the list shrinks after refresh", () => {
    expect(clampPage(10, 100)).toBe(4);
    expect(clampPage(0, 100)).toBe(1);
    expect(clampPage(5, 0)).toBe(1);
  });
  it("shows at most 5 page buttons", () => {
    expect(visiblePages(1, 1500)).toEqual([1, 2, 3, 4, 5]);
    expect(visiblePages(30, 1500)).toEqual([28, 29, 30, 31, 32]);
    expect(visiblePages(60, 1500)).toEqual([56, 57, 58, 59, 60]);
    expect(visiblePages(1, 9)).toEqual([1]);
    expect(visiblePages(1, 0)).toEqual([]);
  });
  it("search covers all 1500, not only the current page", () => {
    const hits = filterCustomerList(make(1500), "fictief 1499");
    expect(hits.map(c => c.id)).toEqual(["id-1499"]);
    expect(pageCount(hits.length)).toBe(1);
  });
  it("deep link finds the page of a customer outside page 1", () => {
    expect(pageOfId(make(250), "id-130")).toBe(6);
    expect(pageOfId(make(250), "onbekend")).toBeNull();
  });
});
