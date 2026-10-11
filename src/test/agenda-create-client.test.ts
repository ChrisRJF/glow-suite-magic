import { describe, it, expect, vi } from "vitest";
import { readAgendaMode, buildCreateBody, createViaRoute, BLOCKED_MESSAGE, GROUP_EMPLOYEE_MESSAGE, GROUP_TIME_MESSAGE } from "@/lib/agendaCreateClient";

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const E1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const E2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const RID = "11111111-1111-4111-8111-111111111111";
const form = { customer_id: C, service_id: S, date: "2026-11-09", time: "10:00", employee_ids: [E1], group: [] as any[] };

function client(tenant: any, flag: any) {
  const eq = vi.fn(() => ({ maybeSingle: async () => flag }));
  return { rpc: vi.fn(async () => tenant), from: vi.fn(() => ({ select: () => ({ eq }) })), eq };
}

describe("agenda create client (fictional data, mocks only)", () => {
  it("flag off or no row = legacy; flag on = atomic; reads the resolved salon (also for staff)", async () => {
    expect(await readAgendaMode(client({ data: T, error: null }, { data: { atomic_agenda_enabled: false }, error: null }) as any)).toBe("legacy");
    expect(await readAgendaMode(client({ data: T, error: null }, { data: null, error: null }) as any)).toBe("legacy");
    const c = client({ data: T, error: null }, { data: { atomic_agenda_enabled: true }, error: null });
    expect(await readAgendaMode(c as any)).toBe("atomic");
    expect(c.rpc).toHaveBeenCalledWith("current_tenant_id");
    expect(c.eq).toHaveBeenCalledWith("tenant_id", T);
  });
  it("unreadable flag or salon = blocked", async () => {
    for (const [t, f] of [[{ data: null, error: null }, null], [{ data: T, error: { m: 1 } }, null], [{ data: T, error: null }, { data: null, error: { m: 1 } }], [{ data: T, error: null }, { data: { atomic_agenda_enabled: "true" }, error: null }]])
      expect(await readAgendaMode(client(t, f) as any)).toBe("blocked");
    expect(await readAgendaMode({ rpc: async () => { throw new Error("net"); }, from: () => null } as any)).toBe("blocked");
    expect(BLOCKED_MESSAGE).toMatch(/niets opgeslagen/);
  });
  it("body: only allowed fields, mail off, one or more employees by UUID", () => {
    const r = buildCreateBody(RID, { ...form, employee_ids: [E1, E2] });
    expect(r.ok).toBe(true);
    const b = (r as any).body;
    expect(Object.keys(b).sort()).toEqual(["customer_id", "date", "employee_ids", "journey_id", "journey_session", "notes", "request_id", "send_confirmation", "service_id", "sub_appointments", "time"]);
    expect(b.send_confirmation).toBe(false);
    expect(b.employee_ids).toEqual([E1, E2]);
    expect(buildCreateBody(RID, { ...form, employee_ids: ["Marie"] }).ok).toBe(false);
  });
  it("group: own time required; name-based employee refused, never mapped", () => {
    const ok = buildCreateBody(RID, { ...form, group: [{ person_name: "Fictief", service_id: S, assigned_time: "10:30", assigned_employee: "Niet toegewezen" }] });
    expect((ok as any).body.sub_appointments).toEqual([{ person_name: "Fictief", service_id: S, time: "10:30", employee_id: null }]);
    expect(buildCreateBody(RID, { ...form, group: [{ person_name: "Fictief", service_id: S, assigned_time: "" }] })).toEqual({ ok: false, message: GROUP_TIME_MESSAGE });
    expect(buildCreateBody(RID, { ...form, group: [{ person_name: "Fictief", service_id: S, assigned_time: "10:30", assigned_employee: "Lisa" }] })).toEqual({ ok: false, message: GROUP_EMPLOYEE_MESSAGE });
  });
  it("success, conflict, database error, lost response", async () => {
    const body = (buildCreateBody(RID, form) as any).body;
    const inv = vi.fn(async () => ({ data: { ok: true, appointment_id: "apt-1" }, error: null }));
    expect(await createViaRoute(inv, body)).toEqual({ kind: "created", appointmentId: "apt-1", replay: false });
    expect(inv).toHaveBeenCalledWith("agenda-create-appointment", { body });
    const err = (status: number, json: any) => async () => ({ data: null, error: { context: { status, json: async () => json } } });
    expect(await createViaRoute(err(409, { ok: false, code: "conflict" }), body)).toMatchObject({ kind: "refused", code: "conflict" });
    expect(await createViaRoute(err(503, { ok: false, code: "failed", retry_same_request: true }), body)).toMatchObject({ kind: "unknown" });
    expect(await createViaRoute(err(500, null), body)).toMatchObject({ kind: "unknown" });
    expect(await createViaRoute(async () => { throw new Error("offline"); }, body)).toMatchObject({ kind: "unknown" });
  });
  it("retry after unknown outcome sends the identical body and request id", async () => {
    const body = (buildCreateBody(RID, form) as any).body;
    const seen: any[] = [];
    let n = 0;
    const inv = async (_: string, o: any) => { seen.push(o.body); n++; if (n === 1) throw new Error("lost"); return { data: { ok: true, appointment_id: "apt-1", replay: true }, error: null }; };
    expect((await createViaRoute(inv, body)).kind).toBe("unknown");
    expect(await createViaRoute(inv, body)).toMatchObject({ kind: "created", replay: true });
    expect(seen[0]).toBe(seen[1]);
    expect(seen[1].request_id).toBe(RID);
  });
});

import { manualConfirmationUiFor as uiFor } from "@/lib/agendaCreateClient";
describe("mail choice scope", () => {
  it("shows the choice only for Studio Nova and The Beautycare Clinic with Agenda 3.0 on", () => {
    expect(uiFor("atomic", "1c6c885e-c944-4717-b2ef-9cfdb9fa15ae")).toBe(true);
    expect(uiFor("atomic", "5dbfcbd4-48ff-4010-a1cc-07ed737880ce")).toBe(true);
    expect(uiFor("legacy", "1c6c885e-c944-4717-b2ef-9cfdb9fa15ae")).toBe(false);
    expect(uiFor("atomic", "00000000-0000-4000-8000-000000000001")).toBe(false);
  });
});
