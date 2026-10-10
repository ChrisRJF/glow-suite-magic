import { describe, it, expect } from "vitest";
import { authorizeEmailRequest, type EmailAuthDeps } from "../../supabase/functions/_shared/inactive/emailSendAuth";

const SALON_A = "11111111-1111-1111-1111-111111111111";
const SALON_B = "22222222-2222-2222-2222-222222222222";
const deps = (o: Partial<EmailAuthDeps> = {}): EmailAuthDeps => ({
  serviceRoleKey: "svc-key-fictief",
  verifyUser: async (t) => ({ ownerA: SALON_A, staffA: "staff-a", recA: "rec-a" } as Record<string, string>)[t] ?? null,
  tenantForUser: async (u) => (u === SALON_A || u === "staff-a" || u === "rec-a" ? SALON_A : null),
  rolesForUser: async (u) => (u === SALON_A ? ["eigenaar"] : u === "staff-a" ? ["manager"] : ["receptie"]),
  ...o,
});

describe("send-white-label-email authorization (inactive)", () => {
  it("rejects missing auth", async () => {
    expect((await authorizeEmailRequest(null, SALON_A, deps())).ok).toBe(false);
  });
  it("rejects invalid jwt", async () => {
    expect(await authorizeEmailRequest("Bearer nope", SALON_A, deps())).toMatchObject({ ok: false, status: 401 });
  });
  it("allows owner for own salon", async () => {
    expect(await authorizeEmailRequest("Bearer ownerA", SALON_A, deps())).toMatchObject({ ok: true, tenantId: SALON_A });
  });
  it("allows manager of same salon", async () => {
    expect((await authorizeEmailRequest("Bearer staffA", SALON_A, deps())).ok).toBe(true);
  });
  it("rejects spoofed user_id of other salon", async () => {
    expect(await authorizeEmailRequest("Bearer ownerA", SALON_B, deps())).toMatchObject({ ok: false, status: 403 });
  });
  it("rejects role without email rights", async () => {
    expect(await authorizeEmailRequest("Bearer recA", SALON_A, deps())).toMatchObject({ ok: false, status: 403 });
  });
  it("keeps internal service automations working", async () => {
    expect(await authorizeEmailRequest("Bearer svc-key-fictief", SALON_B, deps())).toMatchObject({ ok: true, caller: "service" });
  });
  it("fails closed on lookup error", async () => {
    const d = deps({ tenantForUser: async () => { throw new Error("db"); } });
    expect(await authorizeEmailRequest("Bearer ownerA", SALON_A, d)).toMatchObject({ ok: false, status: 500 });
  });
  it("empty service key never matches", async () => {
    expect((await authorizeEmailRequest("Bearer ", SALON_A, deps({ serviceRoleKey: "" }))).ok).toBe(false);
  });
});
