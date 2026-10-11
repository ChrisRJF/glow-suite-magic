import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { addDays, biweeklyDates, recurringVisible, recurringTemplate, buildBatch, runBatch, loadBatch, type Store } from "@/lib/recurringAppointments";
import type { CreateBody, CreateOutcome } from "@/lib/agendaCreateClient";

const BC = "1c6c885e-c944-4717-b2ef-9cfdb9fa15ae";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mem = (): Store & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) }; };
const src = { id: U(1), customer_id: U(2), service_id: U(3), start_time: "09:00:00", appointment_date: "2026-10-20", employee_id: U(4) };
const links = [{ appointment_id: U(1), employee_id: U(4) }];
let n = 100; const id = () => U(n++);

describe("calendar", () => {
  it("adds 14 days across DST end (25 Oct 2026) keeping calendar date", () => {
    expect(addDays("2026-10-20", 14)).toBe("2026-11-03");
    expect(addDays("2026-03-20", 14)).toBe("2026-04-03");
  });
  it("future source: starts 14 days later, excludes source", () => {
    expect(biweeklyDates("2026-10-20", "2026-10-11", 2)).toEqual(["2026-11-03", "2026-11-17"]);
  });
  it("past source: next future biweekly date", () => {
    expect(biweeklyDates("2026-09-01", "2026-10-11", 2)).toEqual(["2026-10-13", "2026-10-27"]);
  });
  it("only 2/4/6/8", () => { expect(biweeklyDates("2026-10-20", "2026-10-11", 9)).toEqual([]); });
});

describe("gate", () => {
  it("Beautycare atomic + roles", () => {
    for (const r of ["eigenaar", "admin", "manager", "receptie"]) expect(recurringVisible("atomic", BC, [r])).toBe(true);
    expect(recurringVisible("atomic", BC, ["medewerker"])).toBe(false);
    expect(recurringVisible("legacy", BC, ["eigenaar"])).toBe(false);
    expect(recurringVisible("blocked", BC, ["eigenaar"])).toBe(false);
    expect(recurringVisible("atomic", U(9), ["eigenaar"])).toBe(false);
  });
  it("Studio Nova alleen in atomic mode", () => {
    const SN = "cbd7d158-0133-4f2f-a504-4b82f73f2e20";
    expect(recurringVisible("atomic", SN, ["eigenaar"])).toBe(true);
    expect(recurringVisible("legacy", SN, ["eigenaar"])).toBe(false);
    expect(recurringVisible("atomic", SN, ["medewerker"])).toBe(false);
  });
  it("blocks group/journey/legacy assignment", () => {
    expect(recurringTemplate({ ...src, booking_group_id: U(5) }, links).ok).toBe(false);
    expect(recurringTemplate({ ...src, journey_id: U(5) }, links).ok).toBe(false);
    expect(recurringTemplate(src, []).ok).toBe(false);
    expect(recurringTemplate({ ...src, start_time: null }, links).ok).toBe(false);
    expect(recurringTemplate(src, links).ok).toBe(true);
  });
});

describe("batch", () => {
  const tpl = recurringTemplate(src, links) as any;
  it("send_confirmation false and note", () => {
    const b = buildBatch(src.id, tpl, ["2026-11-03"], id);
    expect(b.ok && b.batch.items[0].body.send_confirmation).toBe(false);
    expect(b.ok && b.batch.items[0].body.notes).toBe("Herhaalafspraak (elke 2 weken)");
  });
  it("unknown stops, resume sends SAME id/body, no duplicates", async () => {
    const s = mem(); const sent: CreateBody[] = [];
    const b = buildBatch(src.id, tpl, ["2026-11-03", "2026-11-17", "2026-12-01"], id); if (!b.ok) throw 0;
    let call = 0;
    const create = async (x: CreateBody): Promise<CreateOutcome> => { sent.push(x); call++; return call === 2 ? { kind: "unknown", message: "?" } : { kind: "created", appointmentId: U(500 + call), replay: false }; };
    const r1 = await runBatch(s, "k", b.batch, create);
    expect(r1.kind).toBe("unknown");
    const reloaded = loadBatch(s, "k")!;
    const r2 = await runBatch(s, "k", reloaded, create);
    expect(r2.kind).toBe("done");
    expect(sent.map((x) => x.request_id)).toEqual([b.batch.items[0].body.request_id, b.batch.items[1].body.request_id, b.batch.items[1].body.request_id, b.batch.items[2].body.request_id]);
    expect(JSON.stringify(sent[1])).toBe(JSON.stringify(sent[2]));
    expect(sent.every((x) => x.send_confirmation === false)).toBe(true);
  });
  it("conflict stops partial series, no further sends", async () => {
    const s = mem(); let calls = 0;
    const b = buildBatch(src.id, tpl, ["2026-11-03", "2026-11-17", "2026-12-01"], id); if (!b.ok) throw 0;
    const create = async (): Promise<CreateOutcome> => { calls++; return calls === 2 ? { kind: "refused", code: "conflict", message: "bezet" } : { kind: "created", appointmentId: U(600), replay: false }; };
    const r = await runBatch(s, "k", b.batch, create);
    expect(r).toMatchObject({ kind: "stopped", date: "2026-11-17", final: true });
    expect(calls).toBe(2);
    expect((await runBatch(s, "k", loadBatch(s, "k")!, create)).kind).toBe("stopped");
    expect(calls).toBe(2);
  });
  it("no storage = nothing sent", async () => {
    const bad: Store = { get: () => null, set: () => { throw new Error("full"); }, remove: () => {} };
    const create = vi.fn();
    const b = buildBatch(src.id, tpl, ["2026-11-03"], id); if (!b.ok) throw 0;
    expect((await runBatch(bad, "k", b.batch, create)).kind).toBe("storage");
    expect(create).not.toHaveBeenCalled();
  });
});
