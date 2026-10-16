import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { schedulerAuthorized } from "../../supabase/functions/viva-payment-reconcile/schedulerAuth.ts";

const fixture = vi.hoisted(() => ({ create: vi.fn(), refresh: vi.fn() }));
vi.mock("https://esm.sh/@supabase/supabase-js@2.49.4", () => ({ createClient: fixture.create }));
vi.mock("../../supabase/functions/_shared/inactive/isvLiveWebhook.ts", () => ({ refreshLiveMerchants: fixture.refresh }));
vi.mock("../../supabase/functions/_shared/viva.ts", () => ({ vivaEnv: () => ({ api: "live" }), getVivaTransaction: vi.fn() }));
const secret = "syntheticSchedulerCredentialForTestsOnly1234567890";
let handler: ((req: Request) => Promise<Response>) | undefined;
beforeAll(async () => {
  vi.stubGlobal("Deno", {
    env: { get: (n: string) => n === "VIVA_RECONCILE_CRON_SECRET" ? secret : "synthetic" },
    serve: (h: typeof handler) => { handler = h; },
  });
  await import("../../supabase/functions/viva-payment-reconcile/index.ts");
});
afterEach(() => { vi.clearAllMocks(); });
const request = (method: string, token?: string) => new Request("http://localhost/reconcile", {
  method, headers: token ? { authorization: `Bearer ${token}` } : {},
});
async function call(req: Request) {
  if (!handler) throw new Error("missing handler");
  return handler(req);
}
describe("scheduler authorization precedes all privileged work", () => {
  it.each(["GET", "POST"])("anonymous %s is 401 without client creation", async (method) => {
    expect((await call(request(method))).status).toBe(401);
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.refresh).not.toHaveBeenCalled();
  });
  it.each(["wrongTokenOfEqualSizexxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "eyJ.user.jwt", "", "anonymous"])("rejects invalid scheduler credential %s", async (token) => {
    expect((await call(request("POST", token))).status).toBe(401);
    expect(fixture.create).not.toHaveBeenCalled();
  });
  it("missing server secret fails closed", () => {
    expect(schedulerAuthorized(request("POST", secret), undefined)).toBe(false);
  });
  it("valid credential allows POST but never a GET health trigger", async () => {
    expect(schedulerAuthorized(request("POST", secret), secret)).toBe(true);
    expect((await call(request("GET", secret))).status).toBe(405);
    expect(fixture.create).not.toHaveBeenCalled();
  });
  it("preflight never starts reconciliation", async () => {
    expect((await call(request("OPTIONS"))).status).toBe(200);
    expect(fixture.create).not.toHaveBeenCalled();
  });
  it("overlap is skipped before KYC refresh", async () => {
    fixture.create.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: false }) });
    expect(await (await call(request("POST", secret))).json()).toEqual({ ok: true, skipped: "locked" });
    expect(fixture.refresh).not.toHaveBeenCalled();
  });
  it("lock storage failure holds before refresh", async () => {
    fixture.create.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ error: "offline" }) });
    expect((await call(request("POST", secret))).status).toBe(503);
    expect(fixture.refresh).not.toHaveBeenCalled();
  });
  it("authenticated scheduled POST refreshes with charges off and releases only its own holder", async () => {
    const filters: Record<string, unknown> = {};
    const chain: any = {
      select: () => chain, delete: () => chain,
      eq: (k: string, v: unknown) => { filters[k] = v; return chain; },
      in: () => chain, gte: () => chain, order: () => chain,
      limit: async () => ({ data: [] }), then: (ok: (v: unknown) => unknown) => Promise.resolve({}).then(ok),
    };
    const rpc = vi.fn().mockResolvedValue({ data: true });
    fixture.create.mockReturnValue({ rpc, from: () => chain });
    fixture.refresh.mockResolvedValue({ updated: 0 });
    const response = await call(request("POST", secret));
    expect(response.status).toBe(200);
    expect(fixture.refresh).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({ _name: "viva-payment-reconcile", _ttl_seconds: 600 });
    expect(filters.lock_name).toBe("viva-payment-reconcile");
    expect(filters.holder).toBe(rpc.mock.calls[0][1]._holder);
  });
});