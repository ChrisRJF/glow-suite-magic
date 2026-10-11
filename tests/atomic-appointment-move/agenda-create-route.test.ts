import { describe, it, expect, vi } from "vitest";
import { handleCreate, type RouteDeps, type RouteResult } from "../../docs/prepared-patches/atomic-appointment-move/agendaCreateRoute";
import { dispatchManualConfirmation, type Deps as MailDeps } from "../../docs/prepared-patches/manual-booking-confirmation/manualConfirmationCore";

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const E1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const E2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const body = { request_id: "11111111-1111-4111-8111-111111111111", customer_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  service_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", date: "2026-10-25", time: "10:00", employee_ids: [E1] };

/** Fictional in-memory "database": the RPC writes all rows of one call, or none. */
function mk(over: Partial<RouteDeps> = {}, rpcImpl?: (args: any) => any) {
  const rows: any[] = [];
  const store = new Map<string, { hash: string; state: "in_progress" | "done"; result?: RouteResult }>();
  const busy = new Set<string>();
  const callCreateAs = vi.fn(async (_actor: string, tenant: string, args: any) => {
    if (rpcImpl) { const r = rpcImpl(args); if (r) return r; }
    const key = `${args._date} ${args._time} ${args._employee_ids.join(",")}`;
    for (const e of args._employee_ids) if (busy.has(`${args._date} ${args._time} ${e}`)) return { ok: false, code: "conflict" };
    args._employee_ids.forEach((e: string) => busy.add(`${args._date} ${args._time} ${e}`));
    const id = `apt-${rows.length + 1}`;
    rows.push({ id, tenant, source: args._source, key });
    return { ok: true, code: "created", appointment_id: id, booking_group_id: args._sub_appointments ? "grp-1" : null };
  });
  const deps: RouteDeps = {
    verifyUser: async (j) => (j === "jwt-ok" ? "u-receptie" : null),
    tenantForUser: async () => ({ tenantId: T, isDemo: true }),
    rolesForUser: async () => ["receptie"],
    readFlag: async () => ({ data: { atomic_agenda_enabled: true }, error: null }),
    claim: async (t, r, h) => {
      const k = `${t}:${r}`; const s = store.get(k);
      if (!s) { store.set(k, { hash: h, state: "in_progress" }); return { state: "new" }; }
      if (s.hash !== h) return { state: "mismatch" };
      return s.state === "done" ? { state: "done", result: s.result! } : { state: "in_progress" };
    },
    finish: async (t, r, result) => { const s = store.get(`${t}:${r}`)!; s.state = "done"; s.result = result; },
    release: async (t, r) => { store.delete(`${t}:${r}`); },
    callCreateAs,
    ...over,
  };
  return { deps, rows, callCreateAs };
}
const call = (deps: RouteDeps, b: any = body, jwt: string | null = "jwt-ok") => handleCreate({ jwt, body: b }, deps);

describe("step 3A server route (fictional salon, mocks only)", () => {
  it("1. one employee: created, source forced to manual, tenant from server", async () => {
    const { deps, rows, callCreateAs } = mk();
    expect(await call(deps)).toMatchObject({ status: 200, ok: true, appointment_id: "apt-1" });
    expect(callCreateAs.mock.calls[0][1]).toBe(T);
    expect(callCreateAs.mock.calls[0][2]).toMatchObject({ _source: "manual", _employee_ids: [E1] });
    expect(rows).toHaveLength(1);
  });
  it("2. multiple employees by UUID; names or duplicates refused", async () => {
    const { deps, callCreateAs } = mk();
    expect((await call(deps, { ...body, employee_ids: [E1, E2] })).ok).toBe(true);
    expect(callCreateAs.mock.calls[0][2]._employee_ids).toEqual([E1, E2]);
    expect(await call(deps, { ...body, request_id: "22222222-2222-4222-8222-222222222222", employee_ids: ["Marie"] })).toMatchObject({ status: 400, code: "invalid_input" });
    expect(await call(deps, { ...body, request_id: "22222222-2222-4222-8222-222222222222", employee_ids: [E1, E1] })).toMatchObject({ code: "invalid_input" });
  });
  it("3. group booking passes sub-appointments; group line without time is refused by the RPC", async () => {
    const ok = mk();
    expect(await call(ok.deps, { ...body, sub_appointments: [{ service_id: body.service_id, time: "10:30" }] })).toMatchObject({ ok: true, booking_group_id: "grp-1" });
    const noTime = mk({}, (a) => (a._sub_appointments?.some((s: any) => !s.time) ? { ok: false, code: "group_line_needs_time", line: 1 } : null));
    expect(await call(noTime.deps, { ...body, sub_appointments: [{ service_id: body.service_id }] })).toMatchObject({ status: 422, code: "group_line_needs_time" });
    expect(noTime.rows).toHaveLength(0);
  });
  it("4. two simultaneous requests for the same slot: one appointment, one conflict", async () => {
    const { deps, rows } = mk();
    const [a, b] = await Promise.all([call(deps), call(deps, { ...body, request_id: "33333333-3333-4333-8333-333333333333" })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ status: 409, code: "conflict" });
    expect(rows).toHaveLength(1);
  });
  it("5/6/7. break, absence, DST gap: server codes pass through, nothing saved", async () => {
    for (const code of ["in_break", "employee_absent", "invalid_local_time"]) {
      const { deps, rows } = mk({}, () => ({ ok: false, code }));
      expect(await call(deps)).toMatchObject({ status: 422, code });
      expect(rows).toHaveLength(0);
    }
  });
  it("7b. date/time are sent as Amsterdam wall time; UTC conversion stays in the database", async () => {
    const { deps, callCreateAs } = mk();
    await call(deps, { ...body, date: "2026-03-29", time: "03:30" });
    expect(callCreateAs.mock.calls[0][2]).toMatchObject({ _date: "2026-03-29", _time: "03:30" });
  });
  it("8. failed transaction: error, no rows, claim released so a retry may run", async () => {
    const { deps, rows } = mk({ callCreateAs: vi.fn().mockRejectedValue(new Error("db down")) });
    expect(await call(deps)).toMatchObject({ status: 503, code: "failed" });
    expect(rows).toHaveLength(0);
    expect(await deps.claim(T, body.request_id, "x")).toEqual({ state: "new" });
  });
  it("9. double click and repeated request: one RPC call, replay returns the same id", async () => {
    const { deps, rows, callCreateAs } = mk();
    const [a, b] = await Promise.all([call(deps), call(deps)]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ code: "in_progress" });
    expect(await call(deps)).toMatchObject({ ok: true, appointment_id: "apt-1", replay: true });
    expect(await call(deps, { ...body, time: "11:00" })).toMatchObject({ code: "request_mismatch" });
    expect(callCreateAs).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
  });
  it("10. flag off = route refuses; flag unreadable = blocked; never an RPC or legacy write", async () => {
    for (const [read, code] of [[{ data: null, error: null }, "disabled"], [{ data: { atomic_agenda_enabled: false }, error: null }, "disabled"],
      [{ data: null, error: new Error("x") }, "unavailable"], [{ data: { atomic_agenda_enabled: "true" }, error: null }, "unavailable"]] as const) {
      const { deps, callCreateAs } = mk({ readFlag: async () => read as any });
      expect(await call(deps)).toMatchObject({ ok: false, code });
      expect(callCreateAs).not.toHaveBeenCalled();
    }
  });
  it("11. no login, employee role, no tenant, client-chosen tenant/source: refused", async () => {
    expect(await call(mk().deps, body, null)).toMatchObject({ status: 401 });
    expect(await call(mk({ rolesForUser: async () => ["medewerker"] }).deps)).toMatchObject({ status: 403, code: "forbidden" });
    expect(await call(mk({ tenantForUser: async () => null }).deps)).toMatchObject({ status: 403 });
    for (const extra of [{ tenant_id: "other" }, { source: "online_booking" }, { user_id: "other" }, { is_demo: false }])
      expect(await call(mk().deps, { ...body, ...extra })).toMatchObject({ status: 400, code: "invalid_input" });
  });
  it("12. confirmation hand-off only after complete create; never on failure or replay", async () => {
    const onCreated = vi.fn().mockResolvedValue(undefined);
    const { deps } = mk({ onCreated });
    await call(deps, { ...body, send_confirmation: true });
    await call(deps, { ...body, send_confirmation: true }); // replay
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated.mock.calls[0][0]).toEqual({ tenantId: T, appointmentId: "apt-1", sendToCustomer: true });
    const bad = mk({ onCreated }, () => ({ ok: false, code: "conflict" }));
    await call(bad.deps, { ...body, request_id: "44444444-4444-4444-8444-444444444444", send_confirmation: true });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
  it("12b. hand-off reaches the inactive mail core with source=manual (mail mocked, nothing sent)", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const mailDeps = (aptId: string): MailDeps => ({
      verifyUser: async () => "u-receptie", tenantForUser: async () => ({ tenantId: T, isDemo: false }), rolesForUser: async () => ["receptie"],
      loadAppointment: async () => ({ id: aptId, user_id: T, is_demo: false, status: "gepland", source: "manual", customer_id: "c", service_id: "s",
        appointment_date: "2026-10-25T09:00:00+00:00", start_time: "10:00", end_time: "11:00", booking_token: null, booking_reference: null, payment_status: "unpaid" }),
      loadEmployeeLinks: async () => [], loadCustomer: async () => ({ name: "Fictief", email: "f@voorbeeld.test", language: "nl" }),
      loadService: async () => ({ name: "Fictief" }), loadSalon: async () => ({ salon_name: "Fictief", public_slug: "fictief", demo_mode: false, is_demo: false }),
      emailAllowed: async () => true, sendingAllowed: async () => true, claim: async () => true, release: async () => {}, send,
      rendererTokenOnlyManageLink: true,
    });
    const { deps } = mk({ onCreated: async ({ appointmentId, sendToCustomer }) => { await dispatchManualConfirmation({ jwt: "jwt-ok", appointmentId, sendToCustomer }, mailDeps(appointmentId)); } });
    await call(deps, { ...body, send_confirmation: true });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
