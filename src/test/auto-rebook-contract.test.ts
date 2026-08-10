/**
 * Contract test — the frontend and backend Auto Rebook engines MUST return the
 * exact same decision for every input. Prevents drift between
 * `src/lib/autoRebook.ts` and `supabase/functions/_shared/autoRebook.ts`.
 *
 * If this fails, update BOTH engines. Never fork the logic.
 */
import { describe, it, expect } from "vitest";
import {
  calculateAutoRebook as frontend,
  AUTO_REBOOK_FALLBACK_DAYS,
} from "@/lib/autoRebook";
import { calculateAutoRebook as backend } from "../../supabase/functions/_shared/autoRebook";

const NOW = new Date("2026-08-10T12:00:00.000Z").getTime();
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();
const inDays = (n: number) => new Date(NOW + n * DAY).toISOString();

const SVC_A = "11111111-1111-1111-1111-111111111111";
const SVC_B = "22222222-2222-2222-2222-222222222222";

const scenarios: Array<{ name: string; input: any }> = [
  {
    name: "geen historie",
    input: { customer_id: "c1", appointments: [], now: NOW },
  },
  {
    name: "toekomstige afspraak",
    input: {
      customer_id: "c2",
      now: NOW,
      appointments: [
        { service_id: SVC_A, appointment_date: daysAgo(90), status: "voltooid", price: 50 },
        { service_id: SVC_A, appointment_date: inDays(3), status: "gepland" },
      ],
    },
  },
  {
    name: "service interval wint",
    input: {
      customer_id: "c3",
      now: NOW,
      serviceIntervals: { [SVC_A]: 28 },
      appointments: [
        { service_id: SVC_A, appointment_date: daysAgo(120), status: "voltooid", price: 40 },
        { service_id: SVC_A, appointment_date: daysAgo(60), status: "voltooid", price: 40 },
        { service_id: SVC_A, appointment_date: daysAgo(30), status: "voltooid", price: 45 },
      ],
    },
  },
  {
    name: "mediaan uit historie",
    input: {
      customer_id: "c4",
      now: NOW,
      appointments: [
        { service_id: SVC_A, appointment_date: daysAgo(100), status: "voltooid", price: 30 },
        { service_id: SVC_A, appointment_date: daysAgo(80), status: "voltooid", price: 30 },
        { service_id: SVC_A, appointment_date: daysAgo(59), status: "voltooid", price: 30 },
      ],
    },
  },
  {
    name: "fallback 42 dagen",
    input: {
      customer_id: "c5",
      now: NOW,
      appointments: [{ service_id: SVC_B, appointment_date: daysAgo(50), status: "voltooid" }],
      servicePrices: { [SVC_B]: 65 },
    },
  },
  {
    name: "nog niet toe",
    input: {
      customer_id: "c6",
      now: NOW,
      appointments: [{ service_id: SVC_B, appointment_date: daysAgo(5), status: "voltooid", price: 20 }],
    },
  },
  {
    name: "geannuleerd telt niet",
    input: {
      customer_id: "c7",
      now: NOW,
      appointments: [
        { service_id: SVC_A, appointment_date: daysAgo(70), status: "voltooid", price: 55 },
        { service_id: SVC_A, appointment_date: inDays(2), status: "geannuleerd" },
      ],
    },
  },
  {
    name: "extreem interval wordt geklemd",
    input: {
      customer_id: "c8",
      now: NOW,
      serviceIntervals: { [SVC_A]: 4000 },
      appointments: [{ service_id: SVC_A, appointment_date: daysAgo(400), status: "voltooid" }],
    },
  },
];

describe("Auto Rebook engine — frontend ↔ backend contract", () => {
  for (const s of scenarios) {
    it(`identiek voor: ${s.name}`, () => {
      expect(backend(s.input)).toEqual(frontend(s.input));
    });
  }
});

describe("Auto Rebook engine — intervalvolgorde", () => {
  it("1. service interval wint van historie", () => {
    const d = frontend(scenarios[2].input);
    expect(d.interval_source).toBe("service");
    expect(d.recommended_interval_days).toBe(28);
    expect(d.should_rebook).toBe(true);
    expect(d.reason).toBe("due_service");
  });

  it("2. mediaan van historische tussenpozen", () => {
    const d = frontend(scenarios[3].input);
    expect(d.interval_source).toBe("history");
    expect(d.recommended_interval_days).toBe(21); // median(20, 21) → 20.5 → 21
    expect(d.should_rebook).toBe(true);
  });

  it("3. fallback 42 dagen zonder historie of interval", () => {
    const d = frontend(scenarios[4].input);
    expect(d.interval_source).toBe("fallback");
    expect(d.recommended_interval_days).toBe(AUTO_REBOOK_FALLBACK_DAYS);
    expect(d.should_rebook).toBe(true);
    expect(d.estimated_value).toBe(65);
  });

  it("4. toekomstige afspraak → nooit rebooken", () => {
    const d = frontend(scenarios[1].input);
    expect(d.should_rebook).toBe(false);
    expect(d.reason).toBe("future_appointment");
  });

  it("5. interval wordt geklemd op 7..365", () => {
    const d = frontend(scenarios[7].input);
    expect(d.recommended_interval_days).toBe(365);
  });

  it("6. geen historie → geen rebook", () => {
    const d = frontend(scenarios[0].input);
    expect(d.should_rebook).toBe(false);
    expect(d.reason).toBe("no_history");
  });
});
