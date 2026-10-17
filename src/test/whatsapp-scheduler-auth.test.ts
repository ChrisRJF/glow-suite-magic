// Targeted tests for the ACTIVE scheduler authentication gate
// (supabase/functions/_shared/whatsappSchedulerAuth.ts) and the retry
// staleness verdict. Fictitious ids/tokens only; no network, no production.
import { describe, it, expect } from "vitest";
import { authorizeSchedulerRequest } from "../../supabase/functions/_shared/whatsappSchedulerAuth.ts";
import { retryAppointmentVerdict } from "../../supabase/functions/_shared/whatsappSecurity.ts";

const CRON = "cron-secret-" + "c".repeat(40);
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // salon A owner
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // salon B owner
const APPT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const req = (token?: string, body: unknown = {}, method = "POST") =>
  new Request("http://localhost/whatsapp-reminder-scheduler", {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

interface MockOpts {
  userId?: string | null; // resolved auth user for non-cron bearers
  ownerRoles?: string[]; // user_roles rows for that user
  membership?: { owner_user_id: string; role: string }[] | null;
  appointment?: { id: string; user_id: string } | null;
}

function mockAdmin(o: MockOpts) {
  const calls: string[] = [];
  const admin = {
    calls,
    auth: {
      getUser: async (token: string) => {
        calls.push("auth.getUser");
        if (o.userId && token === "user-token") return { data: { user: { id: o.userId } }, error: null };
        return { data: { user: null }, error: { message: "invalid" } };
      },
    },
    from(table: string) {
      return {
        select: () => {
          const result = table === "user_roles"
            ? { data: (o.ownerRoles ?? []).map((role) => ({ role })), error: null }
            : table === "user_access"
              ? { data: o.membership ?? [], error: null }
              : table === "appointments"
                ? { data: o.appointment ?? null, error: null }
                : { data: null, error: null };
          const chain: any = {
            eq: () => chain,
            maybeSingle: async () => result,
            then: (onF: any, onR: any) => Promise.resolve(result).then(onF, onR),
          };
          return chain;
        },
      };
    },
  };
  return admin;
}

describe("scheduler gate: scheduled route", () => {
  it("anonymous POST is 401 before any side effect", async () => {
    const d = await authorizeSchedulerRequest(req(), {}, mockAdmin({}), CRON);
    expect(d).toMatchObject({ allow: false, status: 401 });
  });
  it("wrong token is 401", async () => {
    const d = await authorizeSchedulerRequest(req("wrong"), {}, mockAdmin({}), CRON);
    expect(d).toMatchObject({ allow: false, status: 401 });
  });
  it("correct cron secret with {} allows scheduled", async () => {
    const d = await authorizeSchedulerRequest(req(CRON), {}, mockAdmin({}), CRON);
    expect(d).toMatchObject({ allow: true, route: "scheduled" });
  });
  it("cron secret cannot use the manual test route", async () => {
    const d = await authorizeSchedulerRequest(req(CRON, { test_appointment_id: APPT }), mockAdmin({}), CRON);
    expect(d).toMatchObject({ allow: false, status: 403 });
  });
  it("unset cron secret fails closed even for the right-shaped request", async () => {
    const d = await authorizeSchedulerRequest(req(CRON), {}, mockAdmin({}), undefined);
    expect(d).toMatchObject({ allow: false, status: 401 });
  });
  it("GET is 405", async () => {
    const d = await authorizeSchedulerRequest(req(CRON, {}, "GET"), {}, mockAdmin({}), CRON);
    expect(d).toMatchObject({ allow: false, status: 405 });
  });
  it("unknown body fields (including user_id) are rejected", async () => {
    const d = await authorizeSchedulerRequest(req(CRON, { user_id: A }), mockAdmin({}), CRON);
    expect(d).toMatchObject({ allow: false, status: 400 });
  });
});

describe("scheduler gate: user routes", () => {
  const owner = mockAdmin({ userId: A, ownerRoles: ["eigenaar"] });
  it("owner with {} gets a no-dispatch probe", async () => {
    const d = await authorizeSchedulerRequest(req("user-token"), {}, owner, CRON);
    expect(d).toMatchObject({ allow: true, route: "probe", tenantId: A });
  });
  it("owner manual test on own appointment allowed", async () => {
    const admin = mockAdmin({ userId: A, ownerRoles: ["eigenaar"], appointment: { id: APPT, user_id: A } });
    const d = await authorizeSchedulerRequest(req("user-token", { test_appointment_id: APPT }), { test_appointment_id: APPT }, admin, CRON);
    expect(d).toMatchObject({ allow: true, route: "manual", tenantId: A, appointmentId: APPT });
  });
  it("cross-tenant appointment is 403", async () => {
    const admin = mockAdmin({ userId: A, ownerRoles: ["eigenaar"], appointment: null });
    const d = await authorizeSchedulerRequest(req("user-token", { test_appointment_id: APPT }), { test_appointment_id: APPT }, admin, CRON);
    expect(d).toMatchObject({ allow: false, status: 403, reason: "appointment_tenant_mismatch" });
  });
  it("active manager membership may run a manual test in the owner tenant", async () => {
    const admin = mockAdmin({ userId: "member-1", ownerRoles: [], membership: [{ owner_user_id: A, role: "manager" }], appointment: { id: APPT, user_id: A } });
    const d = await authorizeSchedulerRequest(req("user-token", { test_appointment_id: APPT }), { test_appointment_id: APPT }, admin, CRON);
    expect(d).toMatchObject({ allow: true, route: "manual", tenantId: A });
  });
  it("medewerker membership cannot use manual or probe routes", async () => {
    const admin = mockAdmin({ userId: "member-2", ownerRoles: [], membership: [{ owner_user_id: A, role: "medewerker" }] });
    const d = await authorizeSchedulerRequest(req("user-token"), {}, admin, CRON);
    expect(d).toMatchObject({ allow: false, status: 403, reason: "manual_role_not_allowed" });
  });
  it("invalid user JWT is 401", async () => {
    const d = await authorizeSchedulerRequest(req("user-token"), {}, mockAdmin({ userId: null }), CRON);
    expect(d).toMatchObject({ allow: false, status: 401 });
  });
});

describe("retry staleness verdict", () => {
  const row = {
    user_id: A,
    customer_id: "cust-1",
    meta: { appointment_snapshot: { appointment_date: "2026-10-20T10:00:00.000Z", start_time: "10:00" } },
  };
  const appt = {
    user_id: A,
    customer_id: "cust-1",
    status: "confirmed",
    confirmation_status: null,
    appointment_date: "2026-10-20T10:00:00.000Z",
    start_time: "10:00",
  };
  it("unchanged appointment passes", () => {
    expect(retryAppointmentVerdict(row, appt)).toBeNull();
  });
  it("moved appointment is blocked", () => {
    expect(retryAppointmentVerdict(row, { ...appt, start_time: "11:00" })).toBe("appointment_changed");
  });
  it("cancelled appointment is blocked", () => {
    expect(retryAppointmentVerdict(row, { ...appt, status: "geannuleerd" })).toBe("appointment_no_longer_valid");
  });
  it("deleted appointment is blocked", () => {
    expect(retryAppointmentVerdict(row, null)).toBe("appointment_no_longer_valid");
  });
  it("other salon appointment is blocked", () => {
    expect(retryAppointmentVerdict(row, { ...appt, user_id: B })).toBe("appointment_no_longer_valid");
  });
  it("legacy row without snapshot is suppressed, not replayed", () => {
    expect(retryAppointmentVerdict({ ...row, meta: {} }, appt)).toBe("appointment_snapshot_missing");
  });
});
