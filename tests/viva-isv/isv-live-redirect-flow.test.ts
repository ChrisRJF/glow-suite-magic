import { describe, it, expect, vi } from "vitest";

const fake = vi.hoisted(() => ({ client: null as any }));
vi.mock("https://esm.sh/@supabase/supabase-js@2.49.4", () => ({ createClient: () => fake.client }));
vi.mock("../../supabase/functions/_shared/viva.ts", () => ({ getVivaTransaction: async () => { throw new Error("legacy lookup must not run"); } }));

describe("real redirect handler with private ISV order, no live services", () => {
  it("returns pending through UI response even when public metadata route is absent", async () => {
    let handler: ((req: Request) => Promise<Response>) | undefined;
    vi.stubGlobal("Deno", { env: { get: () => "fixture" }, serve: (h: typeof handler) => { handler = h; } });
    vi.stubGlobal("fetch", async () => { throw new Error("no provider network allowed"); });
    const reads: string[] = [];
    fake.client = {
      from(table: string) {
        reads.push(table);
        if (table !== "isv_payment_orders") throw new Error("must not read client-writable payments");
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ error: null, data: { payment_id: "p", tenant_id: "t", order_code: "1234567890", transaction_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", state: "ready" } }) };
        return chain;
      },
    };
    try {
      await import("../../supabase/functions/verify-viva-payment/index.ts");
      if (!handler) throw new Error("handler not registered");
      const response = await handler(new Request("http://localhost/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_code: "1234567890", transaction_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }) }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "pending", reason: "live_disabled" });
      expect(reads.every((t) => t === "isv_payment_orders")).toBe(true);
      expect(reads.length).toBe(3);
    } finally { vi.unstubAllGlobals(); }
  });
});