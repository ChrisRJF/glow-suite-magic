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
    expect(await authorizeEmailRequest("Bearer ownerA", SALON_A, deps(), { mode: "preview" })).toMatchObject({ ok: true, tenantId: SALON_A });
  });
  it("allows manager to preview own salon", async () => {
    expect((await authorizeEmailRequest("Bearer staffA", SALON_A, deps(), { mode: "preview" })).ok).toBe(true);
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

  describe("preview vs manual send", () => {
    const ALLOWED = "klant@fictief.test";
    const roles: Record<string, string[]> = { ownerA: ["eigenaar"], adminA: ["admin"], mgrA: ["manager"], empA: ["medewerker"] };
    const d = deps({
      verifyUser: async (t) => (t in roles ? t : null),
      tenantForUser: async () => SALON_A,
      rolesForUser: async (u) => roles[u] ?? null,
      recipientAllowed: async (tenant, email) => tenant === SALON_A && email === ALLOWED,
    });
    const send = (who: string, to: string) => authorizeEmailRequest(`Bearer ${who}`, SALON_A, d, { mode: "send", recipientEmail: to });
    it("owner and admin may send to an allowed recipient", async () => {
      expect((await send("ownerA", ALLOWED)).ok).toBe(true);
      expect((await send("adminA", " KLANT@fictief.test ")).ok).toBe(true);
    });
    it("owner may not send to an unknown recipient", async () => {
      expect(await send("ownerA", "iemand@elders.test")).toMatchObject({ ok: false, status: 403, error: "recipient_not_allowed" });
      expect((await send("ownerA", "")).ok).toBe(false);
    });
    it("manager and employee may not send", async () => {
      expect(await send("mgrA", ALLOWED)).toMatchObject({ ok: false, status: 403 });
      expect(await send("empA", ALLOWED)).toMatchObject({ ok: false, status: 403 });
    });
    it("employee may not preview", async () => {
      expect((await authorizeEmailRequest("Bearer empA", SALON_A, d, { mode: "preview" })).ok).toBe(false);
    });
    it("missing recipient check denies send", async () => {
      expect((await authorizeEmailRequest("Bearer ownerA", SALON_A, { ...d, recipientAllowed: undefined }, { mode: "send", recipientEmail: ALLOWED })).ok).toBe(false);
    });
    it("recipient lookup error fails closed", async () => {
      const e = { ...d, recipientAllowed: async () => { throw new Error("db"); } };
      expect(await authorizeEmailRequest("Bearer ownerA", SALON_A, e, { mode: "send", recipientEmail: ALLOWED })).toMatchObject({ ok: false, status: 500 });
    });
    it("omitted mode defaults to strict send", async () => {
      expect((await authorizeEmailRequest("Bearer mgrA", SALON_A, d)).ok).toBe(false);
    });
    it("trusted automations still send without recipient check", async () => {
      expect(await authorizeEmailRequest("Bearer svc-key-fictief", SALON_A, d, { mode: "send", recipientEmail: "x@y.test" })).toMatchObject({ ok: true, caller: "service" });
    });
  });
});
