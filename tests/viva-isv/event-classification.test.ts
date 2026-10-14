import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mapVivaStatus, isLogOnlyEvent } from "../../supabase/functions/_shared/inactive/vivaEventClassification";

// Simulated handler: a log-only event stops before any financial mutation.
function simulate(eventTypeId: number | null, statusId: string, seen: Set<string>, eventId: string) {
  const mutations: string[] = [];
  if (seen.has(eventId)) return mutations; // existing duplicate guard
  seen.add(eventId);
  if (isLogOnlyEvent(eventTypeId)) return mutations;
  const s = mapVivaStatus(statusId, eventTypeId ?? undefined);
  if (s === "paid" || s === "refunded" || s === "reversed") mutations.push(`payment:${s}`);
  return mutations;
}

describe("viva event classification (prepared fix)", () => {
  it("1796 stays paid", () => {
    expect(mapVivaStatus("F", 1796)).toBe("paid");
    expect(simulate(1796, "F", new Set(), "a")).toEqual(["payment:paid"]);
  });
  it("1797 stays reversed", () => expect(mapVivaStatus("F", 1797)).toBe("reversed"));
  it("1798 stays refunded", () => {
    expect(mapVivaStatus("F", 1798)).toBe("refunded");
    expect(simulate(1798, "F", new Set(), "b")).toEqual(["payment:refunded"]);
  });
  it("1799 is never refunded or paid and causes no mutations", () => {
    expect(mapVivaStatus("F", 1799)).toBe("pending");
    expect(isLogOnlyEvent(1799)).toBe(true);
    expect(simulate(1799, "F", new Set(), "c")).toEqual([]);
  });
  it("repeated 1799 causes no mutations", () => {
    const seen = new Set<string>();
    expect(simulate(1799, "F", seen, "d")).toEqual([]);
    expect(simulate(1799, "F", seen, "d")).toEqual([]);
    expect(simulate(1799, "F", seen, "e")).toEqual([]);
  });
  it("unknown event types are handled safely (no refund, no reversal)", () => {
    expect(mapVivaStatus("", 9999)).toBe("pending");
    expect(simulate(9999, "", new Set(), "f")).toEqual([]);
    expect(isLogOnlyEvent(9999)).toBe(false);
  });
  it("matches live mapping for all non-1799 events", () => {
    for (const id of [1796, 1797, 1798, 0, 9999]) for (const s of ["F", "E", "X", ""])
      expect(mapVivaStatus(s, id || undefined)).toBe(liveMap(s, id || undefined));
  });
  it("live webhook is untouched and does not import the prepared module", () => {
    const src = readFileSync("supabase/functions/viva-webhook/index.ts", "utf8");
    expect(src).not.toContain("vivaEventClassification");
  });
});

// Copy of current live mapVivaStatus (index.ts lines 174-181).
function liveMap(statusId: string, eventTypeId?: number) {
  if (eventTypeId === 1797) return "reversed";
  if (eventTypeId === 1798 || eventTypeId === 1799) return "refunded";
  if (statusId === "F" || eventTypeId === 1796) return "paid";
  if (statusId === "E") return "failed";
  if (statusId === "X") return "cancelled";
  return "pending";
}
