import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { biweeklyDates, recurringTemplate, buildBatch, runBatch, addDays, recurringCountLabel, RECURRING_COUNTS, type Store } from "@/lib/recurringAppointments";
import type { CreateBody, CreateOutcome } from "@/lib/agendaCreateClient";
import { trialExtensionText } from "@/lib/trialExtension";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mem = (): Store => { const m = new Map<string, string>(); return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) }; };
const src = { id: U(1), customer_id: U(2), service_id: U(3), start_time: "09:00:00", appointment_date: "2027-01-05", employee_id: U(4) };
const links = [{ appointment_id: U(1), employee_id: U(4) }];
let n = 500; const id = () => U(n++);
const tpl = recurringTemplate(src, links) as any;

describe("heel jaar", () => {
  it("26 is allowed, default list kept, label", () => {
    expect([...RECURRING_COUNTS]).toEqual([2, 4, 6, 8, 26]);
    expect(recurringCountLabel(26)).toBe("Heel jaar (26 afspraken)");
    expect(recurringCountLabel(4)).toBe("4");
  });
  it("26 dates, 14 days apart, 364 days total, across DST Mar/Oct 2027", () => {
    const d = biweeklyDates("2027-01-05", "2027-01-01", 26);
    expect(d).toHaveLength(26);
    expect(d[0]).toBe("2027-01-19");
    for (let i = 1; i < 26; i++) expect(addDays(d[i - 1], 14)).toBe(d[i]);
    expect(d[25]).toBe(addDays("2027-01-05", 364));
    expect(d).toContain("2027-03-30"); expect(d).toContain("2027-10-26");
  });
  it("past source starts at next future date", () => {
    expect(biweeklyDates("2026-01-06", "2026-10-11", 26)[0]).toBe("2026-10-13");
  });
  it("26 stable unique requests, same time, no mail", () => {
    const b = buildBatch(U(1), tpl, biweeklyDates("2027-01-05", "2027-01-01", 26), id) as any;
    const ids = b.batch.items.map((i: any) => i.body.request_id);
    expect(new Set(ids).size).toBe(26);
    expect(b.batch.items.every((i: any) => i.body.time === "09:00" && i.body.send_confirmation === false)).toBe(true);
  });
  it("unknown then retry reuses the same id, no duplicates", async () => {
    const b = (buildBatch(U(1), tpl, biweeklyDates("2027-01-05", "2027-01-01", 26), id) as any).batch;
    const sent: string[] = []; let call = 0;
    const create = async (x: CreateBody): Promise<CreateOutcome> => { sent.push(x.request_id); call++; return call === 3 ? { kind: "unknown", message: "?" } as any : { kind: "created" } as any; };
    const s = mem();
    expect((await runBatch(s, "k", b, create)).kind).toBe("unknown");
    expect((await runBatch(s, "k", b, create)).kind).toBe("done");
    expect(sent).toHaveLength(27);
    expect(sent[3]).toBe(sent[2]);
    expect(new Set(sent).size).toBe(26);
  });
  it("conflict halts after earlier created", async () => {
    const b = (buildBatch(U(1), tpl, biweeklyDates("2027-01-05", "2027-01-01", 26), id) as any).batch;
    let call = 0;
    const r = await runBatch(mem(), "k", b, async () => (++call === 10 ? { kind: "refused", code: "slot_conflict", message: "Bezet" } : { kind: "created" }) as any);
    expect(r.kind).toBe("stopped");
    expect(call).toBe(10);
    expect(b.items.filter((i: any) => i.status === "created")).toHaveLength(9);
  });
});

describe("trial extension banner", () => {
  const BC = "1c6c885e-c944-4717-b2ef-9cfdb9fa15ae";
  const sub = { status: "trialing", trial_ends_at: "2026-12-31T23:00:00Z" };
  const before = Date.parse("2026-10-11T18:00:00Z");
  it("Beautycare before 1 Nov sees extension to 1 januari 2027 (CET)", () => {
    expect(trialExtensionText(BC, sub, before)).toBe("Je gratis proefperiode is verlengd tot 1 januari 2027.");
  });
  it("other salons unchanged", () => { expect(trialExtensionText(U(9), sub, before)).toBeNull(); expect(trialExtensionText(null, sub, before)).toBeNull(); });
  it("no message after trial end or when not trialing", () => {
    expect(trialExtensionText(BC, sub, Date.parse("2026-12-31T23:00:00Z"))).toBeNull();
    expect(trialExtensionText(BC, { ...sub, status: "active" }, before)).toBeNull();
  });
});
