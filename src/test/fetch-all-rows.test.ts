import { describe, it, expect } from "vitest";
import { fetchAllRows } from "@/lib/fetchAllRows";

// Fictional customers only: 2.500 names sorted A..Z, served 1000 per request like the backend.
const names = Array.from({ length: 2499 }, (_, i) => `${String.fromCharCode(65 + (i % 25))}-Fictief ${i}`);
names.push("Zoë Zuiderveen (fictief)");
names.sort();
const server = (from: number, to: number) => Promise.resolve({ data: names.slice(from, to + 1).map((name, id) => ({ id: from + id, name })), error: null });

describe("fetchAllRows", () => {
  it("returns all 2.500 customers, not just the first 1.000", async () => {
    const { data } = await fetchAllRows(server);
    expect(data.length).toBe(2500);
  });
  it("includes a new customer starting with Z", async () => {
    const { data } = await fetchAllRows(server);
    expect(data.some((c) => c.name.startsWith("Zoë"))).toBe(true);
    expect(data.filter((c) => c.name.toLowerCase().includes("zuiderveen")).length).toBe(1);
  });
  it("stops on an exact multiple of the page size", async () => {
    let calls = 0;
    const { data } = await fetchAllRows((f, t) => { calls++; return Promise.resolve({ data: f < 2000 ? Array(t - f + 1).fill({}) : [], error: null }); });
    expect(data.length).toBe(2000);
    expect(calls).toBe(3);
  });
  it("reports an error instead of silently returning a partial list", async () => {
    const { error } = await fetchAllRows(() => Promise.resolve({ data: null, error: { message: "x" } }));
    expect(error).toBeTruthy();
  });
});
