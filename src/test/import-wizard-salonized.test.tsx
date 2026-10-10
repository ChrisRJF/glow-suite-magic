// End-to-end test of the real ImportWizard UI with a fake in-memory backend (no network).
// Fixture is a SYNTHETIC Salonized-like export: the real Salonized file was not available,
// so the exact column format is not verified.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import * as XLSX from "xlsx";
import { MemoryRouter } from "react-router-dom";

const db: Record<string, any[]> = {};
const fail = { customersPage: 0, itemsInsertCall: 0 };
const counters = { customersRangeCalls: 0, itemsInsertCalls: 0, customerInsertCalls: 0 };
let uid = 0;
const USER = "00000000-0000-0000-0000-00000000fake";
const authValue = vi.hoisted(() => ({ user: { id: "00000000-0000-0000-0000-00000000fake" } }));

function q(table: string) {
  const st: any = { filters: [] as ((r: any) => boolean)[], op: "select", range: null, single: false, payload: null, limit: null };
  const rows = () => (db[table] ??= []);
  const exec = async () => {
    if (st.op === "insert") {
      const arr = Array.isArray(st.payload) ? st.payload : [st.payload];
      if (table === "import_batch_items") {
        counters.itemsInsertCalls++;
        if (fail.itemsInsertCall && counters.itemsInsertCalls === fail.itemsInsertCall) return { data: null, error: { message: "items fail" } };
      }
      if (table === "customers") counters.customerInsertCalls++;
      const ins = arr.map((r: any) => ({ id: `id-${++uid}`, created_at: new Date().toISOString(), ...r }));
      rows().push(...ins);
      return { data: st.single ? ins[0] : ins, error: null };
    }
    const match = rows().filter((r) => st.filters.every((f: any) => f(r)));
    if (st.op === "update") { match.forEach((r) => Object.assign(r, st.payload)); return { data: null, error: null }; }
    if (st.op === "delete") { db[table] = rows().filter((r) => !match.includes(r)); return { data: null, error: null }; }
    if (st.range) {
      if (table === "customers") counters.customersRangeCalls++;
      if (table === "customers" && fail.customersPage && counters.customersRangeCalls === fail.customersPage) return { data: null, error: { message: "page fail" } };
      const [f, t] = st.range;
      const sorted = [...match].sort((a, b) => a.id.localeCompare(b.id));
      return { data: sorted.slice(f, Math.min(t, f + 999) + 1), error: null }; // backend max 1000 rows
    }
    const out = st.limit ? match.slice(0, st.limit) : match.slice(0, 1000);
    return { data: st.single ? out[0] ?? null : out, error: null };
  };
  const b: any = {
    select: () => b,
    insert: (p: any) => { st.op = "insert"; st.payload = p; return b; },
    update: (p: any) => { st.op = "update"; st.payload = p; return b; },
    delete: () => { st.op = "delete"; return b; },
    eq: (c: string, v: any) => { st.filters.push((r: any) => r[c] === v); return b; },
    in: (c: string, v: any[]) => { st.filters.push((r: any) => v.includes(r[c])); return b; },
    order: () => b,
    limit: (n: number) => { st.limit = n; return b; },
    range: (f: number, t: number) => { st.range = [f, t]; return b; },
    single: () => { st.single = true; return b; },
    maybeSingle: () => { st.single = true; return b; },
    then: (res: any, rej: any) => exec().then(res, rej),
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => q(t) } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authValue }));
vi.mock("@/hooks/useDemoMode", () => ({ useDemoMode: () => ({ demoMode: false }) }));
vi.mock("@/hooks/useUserRole", () => ({ useUserRole: () => ({ isAdmin: true, loading: false }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { ImportWizard } from "@/components/ImportWizard";

// ---------- Synthetic Salonized-like fixture: 15.902 rows ----------
const HEAD = ["Naam", "E-mailadres", "Mobiel", "Geboortedatum", "Notities"];
type R = [string, string, string, string, string];
function buildFixture(): { rows: R[]; expect: { fresh: number; dupes: number; conflicts: number; missing: number; invalid: number } } {
  const rows: R[] = [];
  const variants = (n: number) => [`+316${n}`, `00316${n}`, `+31 (0)6 ${n}`];
  for (let i = 0; i < 6623; i++) {
    const n = 10000000 + i;
    rows.push([`Fictief ${i}`, `f${i}@voorbeeld.test`, `06${n}`, "01-01-1990", ""]);
    rows.push([` Fictief ${i} `, ` F${i}@Voorbeeld.TEST `, variants(n)[i % 3], "", ""]);
  }
  for (let i = 0; i < 5; i++) rows.push([`Kind ${i}`, `kind${i}@voorbeeld.test`, `06${10000000 + i}`, "", "gedeelde gezinstelefoon"]);
  for (let i = 5; i < 10; i++) rows.push([`Fictief ${i}`, `f${i}@voorbeeld.test`, `06${40000000 + i}`, "", "zelfde mail ander nummer"]);
  for (let i = 10; i < 15; i++) rows.push([`Andere naam ${i}`, `f${i}@voorbeeld.test`, "", "", "zelfde mail andere naam"]);
  for (let i = 0; i < 10; i++) rows.push([`Fout mail ${i}`, `geen-mail-${i}`, "", "", ""]);
  for (let i = 0; i < 10; i++) rows.push([`Fout tel ${i}`, "", "123", "", ""]);
  for (let i = 0; i < 10; i++) rows.push(["", "", "", "", "alleen notitie"]);
  for (let i = 0; i < 20; i++) rows.push([`Alleen Naam ${i}`, "", "", "", ""]);
  for (let i = 0; i < 5; i++) rows.push([`Alleen Naam ${i}`, "", "", "", "naam herhaald"]);
  const singles = 15902 - rows.length;
  for (let i = 0; i < singles; i++) {
    const mode = i % 3;
    rows.push([`Enkel ${i}`, mode !== 1 ? `  S${i}@Voorbeeld.test ` : "", mode !== 2 ? `06${30000000 + i}` : "", "", ""]);
  }
  return { rows, expect: { fresh: 6623 + 20 + singles, dupes: 6623, conflicts: 20, missing: 10, invalid: 20 } };
}
const FX = buildFixture();
const csvEsc = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const CSV = [HEAD, ...FX.rows].map((r) => r.map(csvEsc).join(",")).join("\n");
function xlsxBytes() {
  const ws = XLSX.utils.aoa_to_sheet([HEAD, ...FX.rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Klanten");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

const card = (label: string) => Number(screen.getByText(label).parentElement!.textContent!.replace(label, "").replace(/\D/g, ""));

async function toPreview(file: File) {
  render(<MemoryRouter><ImportWizard /></MemoryRouter>);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(await screen.findByRole("button", { name: /Volgende/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Auto-detecteer kolommen/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Preview/ }));
}
const waitPreview = () => screen.findByText("Wordt geïmporteerd", {}, { timeout: 30000 });
async function startImport() {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /Importeer \d+ nieuwe/ }));
}
// jsdom File lacks text()/arrayBuffer(); provide a minimal File-like object.
const fakeFile = (name: string, content: string | ArrayBuffer) => ({ name, text: async () => content as string, arrayBuffer: async () => content as ArrayBuffer }) as unknown as File;
const csvFile = () => fakeFile("salonized-fictief.csv", CSV);
const customers = () => (db.customers ?? []).filter((c) => c.user_id === USER);

beforeEach(() => {
  cleanup();
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(fail, { customersPage: 0, itemsInsertCall: 0 });
  Object.assign(counters, { customersRangeCalls: 0, itemsInsertCalls: 0, customerInsertCalls: 0 });
  vi.clearAllMocks();
  window.confirm = () => true;
});

describe("ImportWizard Salonized re-import (synthetic)", () => {
  it("fixture has 15.902 rows with 6.623 exact pairs", () => {
    expect(FX.rows.length).toBe(15902);
  });

  it("CSV: preview, import, then identical re-import adds 0 rows; >10k existing loaded in 1.000-row pages", async () => {
    await toPreview(csvFile());
    await waitPreview();
    expect({ fresh: card("Wordt geïmporteerd"), dupes: card("Dubbel (overgeslagen)"), conflicts: card("Conflict (handmatig)"), missing: card("Gegevens ontbreken"), invalid: card("Ongeldige waarden") }).toEqual(FX.expect);
    await startImport();
    await waitFor(() => expect(toast.warning).toHaveBeenCalled(), { timeout: 60000 });
    expect(customers().length).toBe(FX.expect.fresh);
    // batched: ceil(9.229 / 200) = 47 inserts instead of 9.229
    expect(counters.customerInsertCalls).toBe(Math.ceil(FX.expect.fresh / 200));
    const batch = db.import_batches[0];
    expect(batch.status).toBe("completed_with_errors");
    expect(batch.imported_count).toBe(FX.expect.fresh);
    expect(db.import_batch_items.filter((i: any) => i.table_name === "customers").length).toBe(FX.expect.fresh);
    // no exact duplicates were created
    const keys = customers().filter((c) => c.email || c.phone).map((c) => `${c.email}|${c.phone}`);
    expect(new Set(keys).size).toBe(keys.length);

    // add a Z customer manually, then import the identical file again
    db.customers.push({ id: "zzzz-manual", user_id: USER, is_demo: false, name: "Zoë Zuiderveen", email: null, phone: null });
    cleanup();
    counters.customersRangeCalls = 0;
    await toPreview(csvFile());
    await waitPreview();
    expect(counters.customersRangeCalls).toBe(10); // 9.230 rows -> 10 pages of 1.000
    expect(card("Wordt geïmporteerd")).toBe(0);
    expect(screen.getByRole("button", { name: /Importeer 0 nieuwe/ })).toBeDisabled();
    expect(customers().length).toBe(FX.expect.fresh + 1);
  }, 180000);

  it("XLSX gives the same preview counts as CSV", async () => {
    await toPreview(fakeFile("salonized-fictief.xlsx", xlsxBytes()));
    await waitPreview();
    expect(card("Wordt geïmporteerd")).toBe(FX.expect.fresh);
    expect(card("Dubbel (overgeslagen)")).toBe(FX.expect.dupes);
    expect(card("Conflict (handmatig)")).toBe(FX.expect.conflicts);
  }, 120000);

  it("page 9 failure with >10k existing: exact message, no import possible, nothing written", async () => {
    db.customers = Array.from({ length: 10500 }, (_, i) => ({ id: `ex-${String(i).padStart(6, "0")}`, user_id: USER, is_demo: false, name: `Bestaand ${i}`, email: `b${i}@voorbeeld.test`, phone: null }));
    fail.customersPage = 9;
    await toPreview(csvFile());
    expect(await screen.findByText("Niet alle klanten konden worden geladen. Probeer het opnieuw.", {}, { timeout: 30000 })).toBeInTheDocument();
    expect(db.customers.length).toBe(10500);
    expect(db.import_batches ?? []).toHaveLength(0);
  }, 120000);

  it("registration failure rolls back that chunk; restart of same file completes without duplicates; undo removes all", async () => {
    fail.itemsInsertCall = 3; // third chunk registration fails
    await toPreview(csvFile());
    await waitPreview();
    await startImport();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Importregistratie mislukt/)), { timeout: 60000 });
    expect(customers().length).toBe(400);
    expect(db.import_batch_items.length).toBe(400);
    expect(db.import_batches[0].status).toBe("failed");

    cleanup();
    fail.itemsInsertCall = 0;
    await toPreview(csvFile());
    await waitPreview();
    expect(card("Wordt geïmporteerd")).toBe(FX.expect.fresh - 400);
    await startImport();
    await waitFor(() => expect(toast.warning).toHaveBeenCalled(), { timeout: 60000 });
    expect(customers().length).toBe(FX.expect.fresh);

    fireEvent.click(screen.getByRole("button", { name: /Import ongedaan maken/ }));
    await waitFor(() => expect(customers().length).toBe(400), { timeout: 30000 });
    expect(db.import_batches[1].status).toBe("undone");
  }, 240000);
});
