/**
 * Auto Rebook — production completion guarantees.
 * Locks the behaviours fixed in the completion sprint so they cannot regress.
 */
import { describe, it, expect } from "vitest";
import { calculateAutoRebook } from "@/lib/autoRebook";

const NOW = new Date("2026-08-10T12:00:00.000Z").getTime();
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();
const SVC = "11111111-1111-1111-1111-111111111111";

describe("canonieke bezoekdefinitie", () => {
  it("een verlopen maar niet afgeronde afspraak telt niet als bezoek", () => {
    const d = calculateAutoRebook({
      customer_id: "c1",
      now: NOW,
      appointments: [{ service_id: SVC, appointment_date: daysAgo(90), status: "gepland" }],
    });
    expect(d.should_rebook).toBe(false);
    expect(d.reason).toBe("no_history");
  });

  it("een afgeronde afspraak telt wel", () => {
    const d = calculateAutoRebook({
      customer_id: "c2",
      now: NOW,
      appointments: [{ service_id: SVC, appointment_date: daysAgo(90), status: "voltooid" }],
    });
    expect(d.should_rebook).toBe(true);
  });

  it("no-show telt niet als bezoek", () => {
    const d = calculateAutoRebook({
      customer_id: "c3",
      now: NOW,
      appointments: [{ service_id: SVC, appointment_date: daysAgo(90), status: "no_show" }],
    });
    expect(d.should_rebook).toBe(false);
  });
});

describe("stabiele cyclus-identiteit", () => {
  it("levert het id van de laatste afgeronde afspraak", () => {
    const d = calculateAutoRebook({
      customer_id: "c4",
      now: NOW,
      appointments: [
        { id: "a1", service_id: SVC, appointment_date: daysAgo(200), status: "voltooid" },
        { id: "a2", service_id: SVC, appointment_date: daysAgo(90), status: "voltooid" },
      ],
    });
    expect(d.last_appointment_id).toBe("a2");
  });

  it("blijft gelijk als het serviceinterval verandert", () => {
    const base = {
      customer_id: "c5",
      now: NOW,
      appointments: [{ id: "a9", service_id: SVC, appointment_date: daysAgo(90), status: "voltooid" }],
    };
    const a = calculateAutoRebook({ ...base, serviceIntervals: { [SVC]: 28 } });
    const b = calculateAutoRebook({ ...base, serviceIntervals: { [SVC]: 56 } });
    expect(a.last_appointment_id).toBe(b.last_appointment_id);
    expect(a.expected_return_date).not.toBe(b.expected_return_date);
  });
});
