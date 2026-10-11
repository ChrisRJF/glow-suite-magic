import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => { throw new Error("no table access"); }, functions: { invoke: () => { throw new Error("no function calls"); } } } }));

import { demoCheckoutVisible, readDemoCheckoutVisible } from "@/lib/demoCheckout";

const BC = "1c6c885e-c944-4717-b2ef-9cfdb9fa15ae";
const NOVA = "cbd7d158-0133-4f2f-a504-4b82f73f2e20";

describe("demo checkout gate", () => {
  it("Beautycare + allowed roles visible", () => {
    for (const r of ["eigenaar", "admin", "manager", "receptie"]) expect(demoCheckoutVisible(BC, [r], false)).toBe(true);
  });
  it("medewerker/financieel/no role hidden", () => {
    expect(demoCheckoutVisible(BC, ["medewerker"], false)).toBe(false);
    expect(demoCheckoutVisible(BC, ["financieel"], false)).toBe(false);
    expect(demoCheckoutVisible(BC, [], false)).toBe(false);
  });
  it("other salons hidden", () => {
    expect(demoCheckoutVisible(NOVA, ["eigenaar"], false)).toBe(false);
    expect(demoCheckoutVisible(null, ["eigenaar"], false)).toBe(false);
  });
  it("real checkout visible = demo hidden", () => {
    expect(demoCheckoutVisible(BC, ["eigenaar"], true)).toBe(false);
  });
  it("Studio Nova: simulatie ook naast echte Viva-demo checkout", () => {
    const SN = "cbd7d158-0133-4f2f-a504-4b82f73f2e20";
    expect(demoCheckoutVisible(SN, ["eigenaar"], true)).toBe(true);
    expect(demoCheckoutVisible(SN, ["admin"], false)).toBe(true);
    expect(demoCheckoutVisible(SN, ["medewerker"], true)).toBe(false);
  });
  it("RPC error or throw = hidden", async () => {
    rpc.mockResolvedValueOnce({ data: BC, error: { message: "x" } });
    expect(await readDemoCheckoutVisible(["eigenaar"], false)).toBe(false);
    rpc.mockRejectedValueOnce(new Error("net"));
    expect(await readDemoCheckoutVisible(["eigenaar"], false)).toBe(false);
    rpc.mockResolvedValueOnce({ data: BC, error: null });
    expect(await readDemoCheckoutVisible(["eigenaar"], false)).toBe(true);
  });
  it("demo panel makes no network or backend calls", () => {
    const src = readFileSync(path.resolve(__dirname, "../../src/components/DemoCheckoutPanel.tsx"), "utf8");
    for (const bad of ["supabase", "fetch(", "invoke", "callCheckout", "localStorage", "sessionStorage", "window.open", "href="]) expect(src.includes(bad)).toBe(false);
  });
});
