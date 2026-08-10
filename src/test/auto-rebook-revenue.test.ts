/**
 * Auto Rebook 1.0 — final blocker coverage.
 *
 * 1. Retry cycle validity (expired token, already booked, closed cycle)
 * 2. Hub pagination for large salons (no silent 2000 truncation)
 * 3. UI single source: no component keeps its own rebook thresholds
 *
 * The revenue reconciliation itself lives in `public.sync_auto_rebook_revenue`
 * and is verified against the database (see the migration + scenario run).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  rebookCycleStillValid,
  canStillSendRebook,
} from "../../supabase/functions/_shared/autoRebookGuards";

/** Minimal chainable stub of the supabase admin client. */
function makeAdmin(tables: Record<string, any>) {
  return {
    rpc: vi.fn(),
    from(table: string) {
      const api: any = {
        select: () => api,
        eq: () => api,
        gte: () => api,
        not: () => api,
        limit: () => api,
        maybeSingle: async () => ({ data: tables[table] ?? null }),
      };
      return api;
    },
  } as any;
}

const OPEN_CYCLE = {
  id: "ra-1",
  status: "verzonden",
  booked_at: null,
  token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
};

describe("retry cycle validity", () => {
  it("7. verlopen token → geen verzending", async () => {
    const admin = makeAdmin({
      rebook_actions: { ...OPEN_CYCLE, token_expires_at: new Date(Date.now() - 1000).toISOString() },
    });
    expect(await rebookCycleStillValid(admin, "ra-1")).toEqual({ allowed: false, reason: "token_expired" });
  });

  it("8. cyclus al geboekt → geen verzending", async () => {
    const admin = makeAdmin({ rebook_actions: { ...OPEN_CYCLE, booked_at: new Date().toISOString() } });
    expect(await rebookCycleStillValid(admin, "ra-1")).toEqual({ allowed: false, reason: "cycle_already_booked" });
  });

  it("gesloten status → geen verzending", async () => {
    for (const status of ["vervallen", "suppressed", "mislukt", "gerealiseerd"]) {
      const admin = makeAdmin({ rebook_actions: { ...OPEN_CYCLE, status } });
      const res = await rebookCycleStillValid(admin, "ra-1");
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe(`cycle_${status}`);
    }
  });

  it("ontbrekende claim → geen verzending", async () => {
    const admin = makeAdmin({});
    expect(await rebookCycleStillValid(admin, "ra-1")).toEqual({ allowed: false, reason: "rebook_action_missing" });
  });

  it("open cyclus blijft toegestaan", async () => {
    const admin = makeAdmin({ rebook_actions: OPEN_CYCLE });
    expect(await rebookCycleStillValid(admin, "ra-1")).toEqual({ allowed: true, reason: "ok" });
  });

  it("canStillSendRebook draagt de cycluscheck mee", async () => {
    const admin = makeAdmin({
      whatsapp_settings: { enabled: true, send_revenue_boost: true },
      whatsapp_templates: { is_active: true },
      customer_message_preferences: { retention_opt_out: false },
      appointments: null,
      rebook_actions: { ...OPEN_CYCLE, booked_at: new Date().toISOString() },
    });
    const res = await canStillSendRebook(admin, "u1", "c1", "ra-1");
    expect(res).toEqual({ allowed: false, reason: "cycle_already_booked" });
  });
});

describe("hub — grote salons", () => {
  beforeEach(() => vi.resetModules());

  it("9. >2000 klanten worden volledig doorlopen", async () => {
    const pages = [1000, 1000, 500];
    const rpc = vi.fn(async (_fn: string, args: any) => {
      const page = args._offset / 1000;
      const n = pages[page] ?? 0;
      return {
        data: Array.from({ length: n }, (_, i) => ({
          customer_id: `c${page}-${i}`,
          appointments: [
            { id: `a${page}-${i}`, service_id: null, appointment_date: new Date(Date.now() - 200 * 86_400_000).toISOString(), status: "voltooid", price: 40 },
          ],
        })),
        error: null,
      };
    });
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
    const { fetchDueRebookCustomers } = await import("@/lib/autoRebookClient");
    const rows = await fetchDueRebookCustomers([]);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rows.length).toBe(2500);
  });
});

describe("UI single source", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("10. RevenueOpportunities heeft geen eigen rebook-drempel", () => {
    const src = read("src/components/RevenueOpportunities.tsx");
    expect(src).not.toMatch(/daysSince\s*>\s*60/);
    expect(src).toContain("useDueRebook");
    expect(src).toContain('reason === "due_fallback"');
  });

  it("11. CustomerValueIntel gebruikt de canonieke engine", () => {
    const src = read("src/components/CustomerValueIntel.tsx");
    expect(src).not.toMatch(/avgCycle\s*\*\s*0\.8/);
    expect(src).toContain("calculateAutoRebook");
    expect(src).toContain("rebookDecision.should_rebook");
  });
});
