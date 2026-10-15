import { describe, it, expect, vi } from "vitest";
import { handleCreate, type RouteDeps } from "../../docs/prepared-patches/atomic-appointment-move/agendaCreateRoute";
import { dispatchManualConfirmation, type Deps as MailDeps } from "../../docs/prepared-patches/manual-booking-confirmation/manualConfirmationCore";

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const E1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const E2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const body = { request_id: "11111111-1111-4111-8111-111111111111", customer_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  service_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", date: "2026-10-25", time: "10:00", employee_ids: [E1] };

/** Fictional in-memory "database" mirroring create_appointment_atomic_as: request row + rows in one step. */
function mk(over: Partial<RouteDeps> = {}, rpcImpl?: (args: any) => any) {
  const rows: any[] = [];
  const requests = new Map<string, { hash: string; id: string; group: string | null; send: boolean }>();
  const busy = new Set<string>();
  const callCreateAs = vi.fn(async (_actor: string, tenant: string, args: any) => {
    const hash = JSON.stringify({ ...args, _request_id: undefined });
    const prev = requests.get(args._request_id);
    if (prev) return prev.hash === hash ? { ok: true, code: "created", replay: true, appointment_id: prev.id, booking_group_id: prev.group, send_confirmation: prev.send } : { ok: false, code: "request_mismatch" };
    if (rpcImpl) { const r = rpcImpl(args); if (r) return r; }
    for (const e of args._employee_ids) if (busy.has(`${args._date} ${args._time} ${e}`)) return { ok: false, code: "conflict" };
    args._employee_ids.forEach((e: string) => busy.add(`${args._date} ${args._time} ${e}`));
    const id = `apt-${rows.length + 1}`; const group = args._sub_appointments ? "grp-1" : null;
    rows.push({ id, tenant, source: "manual" });
    requests.set(args._request_id, { hash, id, group, send: args._send_confirmation });
    return { ok: true, code: "created", replay: false, appointment_id: id, booking_group_id: group, send_confirmation: args._send_confirmation };
  });
  const deps: RouteDeps = {
    verifyUser: async (j) => (j === "jwt-ok" ? U : null),
    actorContext: async () => ({ tenantId: T, role: "receptie", salonIsDemo: true, membershipIsDemo: true }),
    readFlag: async () => ({ data: { atomic_agenda_enabled: true }, error: null }),
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
    expect(callCreateAs.mock.calls[0][2]).toMatchObject({ _request_id: body.request_id, _employee_ids: [E1] });
    expect(callCreateAs.mock.calls[0][2]).not.toHaveProperty("_source"); // fixed inside the database
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
  it("8. lost connection / failed call: retry with same id never creates a second appointment", async () => {
    const m = mk();
    const real = m.callCreateAs.getMockImplementation()!;
    m.callCreateAs.mockImplementationOnce(async (...a: any[]) => { await (real as any)(...a); throw new Error("response lost after commit"); });
    expect(await call(m.deps)).toMatchObject({ status: 503, code: "failed" });
    expect(await call(m.deps)).toMatchObject({ ok: true, appointment_id: "apt-1", replay: true });
    expect(m.rows).toHaveLength(1);
  });
  it("9. double click and repeated request: one appointment, replay returns the same id; changed content refused", async () => {
    const { deps, rows } = mk();
    const [a, b] = await Promise.all([call(deps), call(deps)]);
    expect(a.ok && b.ok && (a as any).appointment_id === (b as any).appointment_id).toBe(true);
    expect(await call(deps, { ...body, time: "11:00" })).toMatchObject({ status: 409, code: "request_mismatch" });
    expect(await call(deps, { ...body, send_confirmation: true })).toMatchObject({ code: "request_mismatch" });
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
    expect(await call(mk({ actorContext: async () => ({ tenantId: T, role: "medewerker", salonIsDemo: true, membershipIsDemo: true }) }).deps)).toMatchObject({ status: 403, code: "forbidden" });
    expect(await call(mk({ actorContext: async () => null }).deps)).toMatchObject({ status: 403 });
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
      // Fixture update: the core now fails closed without an explicit test allow-list (privacy hardening).
      allowedRecipients: new Set(["f@voorbeeld.test"]),
    });
    const { deps } = mk({ onCreated: async ({ appointmentId, sendToCustomer }) => { await dispatchManualConfirmation({ jwt: "jwt-ok", appointmentId, sendToCustomer }, mailDeps(appointmentId)); } });
    await call(deps, { ...body, send_confirmation: true });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("step 3A route hardening (fictional salons, mocks only)", () => {
  const ctx = (role: string, salonIsDemo: boolean, membershipIsDemo: boolean | null) => async () => ({ tenantId: T, role, salonIsDemo, membershipIsDemo });
  it("H1. owner, manager and receptie with valid access create; actor is the verified user", async () => {
    for (const [role, m] of [["eigenaar", null], ["manager", false], ["receptie", false], ["admin", false]] as const) {
      const { deps, callCreateAs } = mk({ actorContext: ctx(role, false, m) });
      expect(await call(deps)).toMatchObject({ status: 200, ok: true, message: "Afspraak opgeslagen." });
      expect(callCreateAs.mock.calls[0][0]).toBe(U);
    }
  });
  it("H2. medewerker and financieel refused with Dutch message, no RPC", async () => {
    for (const role of ["medewerker", "financieel"]) {
      const { deps, callCreateAs } = mk({ actorContext: ctx(role, false, false) });
      const r = await call(deps);
      expect(r).toMatchObject({ status: 403, code: "forbidden" });
      expect(r.message).toMatch(/geen rechten/);
      expect(callCreateAs).not.toHaveBeenCalled();
    }
  });
  it("H3. other salon: no/ambiguous membership refused; DB re-check 'forbidden' passes through", async () => {
    expect(await call(mk({ actorContext: async () => null }).deps)).toMatchObject({ status: 403, code: "forbidden" });
    const db = mk({}, () => ({ ok: false, code: "forbidden" }));
    expect(await call(db.deps)).toMatchObject({ status: 403, code: "forbidden" });
    expect(db.rows).toHaveLength(0);
  });
  it("H4. demo/live separation: staff mode must equal salon mode; unreadable context blocks", async () => {
    for (const [s, m, ok] of [[true, true, true], [false, false, true], [true, false, false], [false, true, false]] as const) {
      const { deps, callCreateAs } = mk({ actorContext: ctx("receptie", s, m) });
      const r = await call(deps);
      expect(r.ok).toBe(ok);
      if (!ok) { expect(r).toMatchObject({ status: 403, code: "mode_mismatch" }); expect(callCreateAs).not.toHaveBeenCalled(); }
    }
    expect(await call(mk({ actorContext: ctx("receptie", true, null) }).deps)).toMatchObject({ code: "mode_mismatch" });
    expect(await call(mk({ actorContext: async () => { throw new Error("db"); } }).deps)).toMatchObject({ status: 503, code: "unavailable" });
  });
  it("H5. invalid, expired or non-uuid identity refused before any read", async () => {
    const actorContext = vi.fn();
    expect(await call(mk({ actorContext }).deps, body, "jwt-expired")).toMatchObject({ status: 401, code: "not_authenticated" });
    expect(await call(mk({ actorContext, verifyUser: async () => { throw new Error("auth down"); } }).deps)).toMatchObject({ status: 401 });
    expect(await call(mk({ actorContext, verifyUser: async () => "not-a-uuid" }).deps)).toMatchObject({ status: 401 });
    expect(actorContext).not.toHaveBeenCalled();
  });
  it("H6. unexpected database error: unknown outcome, retry flag, no mail; retry with same id creates once", async () => {
    const onCreated = vi.fn().mockResolvedValue(undefined);
    const m = mk({ onCreated });
    m.callCreateAs.mockImplementationOnce(async () => { throw new Error("rpc_failed"); });
    expect(await call(m.deps, { ...body, send_confirmation: true })).toMatchObject({ status: 503, code: "failed", retry_same_request: true });
    expect(onCreated).not.toHaveBeenCalled();
    expect(await call(m.deps, { ...body, send_confirmation: true })).toMatchObject({ ok: true, appointment_id: "apt-1" });
    expect(m.rows).toHaveLength(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
  it("H7. unknown body keys (salon, actor, mode) refused", async () => {
    for (const extra of [{ salon_id: T }, { actor: U }, { demo: true }, { _actor: U }])
      expect(await call(mk().deps, { ...body, ...extra })).toMatchObject({ status: 400, code: "invalid_input" });
  });
  it("H8. lost response after commit: no mail on replay, stored choice returned", async () => {
    const onCreated = vi.fn().mockResolvedValue(undefined);
    const m = mk({ onCreated });
    const real = m.callCreateAs.getMockImplementation()!;
    m.callCreateAs.mockImplementationOnce(async (...a: any[]) => { await (real as any)(...a); throw new Error("lost"); });
    await call(m.deps, { ...body, send_confirmation: true });
    expect(await call(m.deps, { ...body, send_confirmation: true })).toMatchObject({ ok: true, replay: true });
    expect(onCreated).not.toHaveBeenCalled(); // known gap: needs the server-side outbox before mail activation
  });
});
