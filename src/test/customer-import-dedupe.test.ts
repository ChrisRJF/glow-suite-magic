import { describe, it, expect } from "vitest";
import { CustomerImportIndex } from "@/lib/customerImportDedupe";
import { fetchAllRows } from "@/lib/fetchAllRows";

type Row = { name: string; email: string | null; phone: string | null };
// Simulates the import loop: decide, then "insert" new rows into a fake store.
function runImport(store: (Row & { id: string })[], rows: Row[]) {
  const idx = new CustomerImportIndex(store);
  const r = { imported: 0, dupes: 0, conflicts: 0 };
  for (const row of rows) {
    const d = idx.decide(row.name, row.email, row.phone);
    if (d.kind === "dupe") r.dupes++;
    else if (d.kind === "conflict") r.conflicts++;
    else { const id = `n${store.length}`; store.push({ id, ...row }); idx.add(id, row.name, row.email, row.phone); r.imported++; }
  }
  return r;
}
const phoneVariants = (n: number) => [`06${n}`, `+316${String(n).slice(1)}`, `00316${String(n).slice(1)}`, `+31 (0)6 ${String(n).slice(1)}`];

describe("customer import dedupe", () => {
  it("06 / +31 / 0031 / +31(0)6 and email case are the same contact", () => {
    const idx = new CustomerImportIndex([{ id: "a", name: "Fictief", email: "x@voorbeeld.test", phone: "0612345678" }]);
    for (const p of ["+31612345678", "0031612345678", "+31 (0)6 12345678", "06-12345678"])
      expect(idx.decide("Fictief", " X@Voorbeeld.TEST ", p)).toEqual({ kind: "dupe", id: "a" });
  });
  it("shared family phone with different email is a conflict, never merged", () => {
    const idx = new CustomerImportIndex([{ id: "a", name: "Ouder", email: "o@voorbeeld.test", phone: "0611111111" }]);
    expect(idx.decide("Kind", "k@voorbeeld.test", "+31611111111").kind).toBe("conflict");
    expect(idx.decide("Ouder", "o@voorbeeld.test", "0622222222").kind).toBe("conflict");
  });
  it("one contact: skip only with same name, otherwise conflict", () => {
    const idx = new CustomerImportIndex([{ id: "a", name: "Sam", email: "s@voorbeeld.test", phone: null }]);
    expect(idx.decide("sam ", "s@voorbeeld.test", null).kind).toBe("dupe");
    expect(idx.decide("Kim", "s@voorbeeld.test", null).kind).toBe("conflict");
  });
  it("name only never counts as duplicate; doubt goes to review", () => {
    const idx = new CustomerImportIndex([{ id: "a", name: "Sam", email: null, phone: null }]);
    expect(idx.decide("Sam", null, null).kind).toBe("conflict");
    expect(idx.decide("Lot", null, null).kind).toBe("new");
    expect(idx.decide("Sam", "ander@voorbeeld.test", "0633333333").kind).toBe("new");
  });

  it("15.902 synthetic rows with 6.623 pairs import 9.279 once, re-import adds nothing", () => {
    const rows: Row[] = [];
    for (let i = 0; i < 6623; i++) {
      const n = 10000000 + i;
      rows.push({ name: `Fictief ${i}`, email: `f${i}@voorbeeld.test`, phone: `06${n}` });
      rows.push({ name: `Fictief ${i}`, email: `F${i}@Voorbeeld.test`, phone: phoneVariants(n)[1 + (i % 3)] });
    }
    for (let i = 0; i < 2656; i++) rows.push({ name: `Enkel ${i}`, email: i % 4 ? `s${i}@voorbeeld.test` : null, phone: i % 4 === 1 ? null : `06${30000000 + i}` });
    expect(rows.length).toBe(15902);
    const store: (Row & { id: string })[] = [];
    expect(runImport(store, rows)).toEqual({ imported: 9279, dupes: 6623, conflicts: 0 });
    expect(runImport(store, rows)).toEqual({ imported: 0, dupes: 15902, conflicts: 0 });
    expect(store.length).toBe(9279);
  });

  it("aborts on a paging error instead of deduping against a partial list (>10k rows)", async () => {
    const all = Array.from({ length: 15902 }, (_, i) => ({ id: i }));
    let page = 0;
    const ok = await fetchAllRows((f, t) => Promise.resolve({ data: all.slice(f, t + 1), error: null }));
    expect(ok.data.length).toBe(15902);
    const bad = await fetchAllRows((f, t) => Promise.resolve(++page === 9 ? { data: null, error: { m: "x" } } : { data: all.slice(f, t + 1), error: null }));
    expect(bad.error).toBeTruthy();
  });
});
