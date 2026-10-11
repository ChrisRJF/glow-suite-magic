import { describe, it, expect } from "vitest";
import { savePending, loadPending, clearPending, purgeOtherPending, PENDING_TTL_MS } from "@/lib/agendaPendingStore";
import { buildCreateBody, createViaRoute, readAgendaContext, NON_DEFINITIVE_REFUSALS, type CreateBody } from "@/lib/agendaCreateClient";

const mem = () => { const m = new Map<string, string>(); return {
  getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v),
  removeItem: (k: string) => void m.delete(k), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; }, m } as any; };
const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222";
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SVC = "33333333-3333-4333-8333-333333333333", RID = "44444444-4444-4444-8444-444444444444";
const body = (): CreateBody => (buildCreateBody(RID, { customer_id: "", service_id: SVC, date: "2026-10-12", time: "10:00", employee_ids: [], group: [] }) as any).body;

describe("pending create request", () => {
  it("survives a refresh with the same id and exact body", () => {
    const s = mem(); const b = body();
    expect(savePending(U1, T1, b, s)).toBe(true);
    expect(loadPending(U1, T1, s)).toEqual(b);
    expect(loadPending(U1, T1, s)!.request_id).toBe(RID);
  });
  it("is never shown to another user or salon, and purge removes others", () => {
    const s = mem(); savePending(U1, T1, body(), s);
    expect(loadPending(U2, T1, s)).toBeNull();
    expect(loadPending(U1, T2, s)).toBeNull();
    purgeOtherPending(U2, T1, s);
    expect(loadPending(U1, T1, s)).toBeNull();
  });
  it("expires and is cleared when definitive", () => {
    const s = mem(); savePending(U1, T1, body(), s, 0);
    expect(loadPending(U1, T1, s, PENDING_TTL_MS + 1)).toBeNull();
    savePending(U1, T1, body(), s); clearPending(U1, T1, s);
    expect(loadPending(U1, T1, s)).toBeNull();
  });
  it("lost answer = unknown; retry sends identical body; replay confirms created", async () => {
    const sent: any[] = []; const b = body();
    const lost = async (_n: string, o: any) => { sent.push(o.body); throw new Error("net"); };
    expect((await createViaRoute(lost, b)).kind).toBe("unknown");
    const replay = async (_n: string, o: any) => { sent.push(o.body); return { data: { ok: true, appointment_id: "x", replay: true }, error: null }; };
    const out = await createViaRoute(replay, b);
    expect(out).toEqual({ kind: "created", appointmentId: "x", replay: true });
    expect(sent[0]).toEqual(sent[1]); expect(sent[1].request_id).toBe(RID); expect(sent[1].send_confirmation).toBe(false);
  });
  it("not saved: conflict is definitive, disabled/logout keep the pending request", async () => {
    const r = (code: string) => async () => ({ data: { ok: false, code }, error: null });
    const c = await createViaRoute(r("conflict"), body());
    expect(c.kind === "refused" && !NON_DEFINITIVE_REFUSALS.has(c.code)).toBe(true);
    for (const code of ["disabled", "not_authenticated", "unavailable"]) {
      const o = await createViaRoute(r(code), body());
      expect(o.kind === "refused" && NON_DEFINITIVE_REFUSALS.has(o.code)).toBe(true);
    }
  });
  it("flag off = legacy, unreadable = blocked, tenant returned", async () => {
    const client = (flag: any) => ({ rpc: async () => ({ data: T1, error: null }),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => flag }) }) }) });
    expect(await readAgendaContext(client({ data: null, error: null }))).toEqual({ mode: "legacy", tenantId: T1 });
    expect(await readAgendaContext(client({ data: { atomic_agenda_enabled: false }, error: null }))).toEqual({ mode: "legacy", tenantId: T1 });
    expect((await readAgendaContext(client({ data: null, error: { message: "x" } }))).mode).toBe("blocked");
  });
});
