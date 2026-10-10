import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCustomerEmailLinks, isAllowedCustomerUrl, isSalonBookingUrl } from "../../supabase/functions/_shared/inactive/emailLinks";
import { buildIcs } from "../../supabase/functions/_shared/inactive/icsBuilder";
import { authorizeEmailRequest } from "../../supabase/functions/_shared/inactive/emailSendAuth";

const TOKEN = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const app = readFileSync("src/App.tsx", "utf8");
const routeExists = (url: string) => {
  const path = new URL(url).pathname;
  return [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]).some((r) => {
    const re = new RegExp("^" + r.replace(/:[^/]+/g, "[^/]+") + "$");
    return re.test(path);
  });
};

describe("customer email links (fictieve salons)", () => {
  it("salon with hyphen in slug", () => {
    const l = buildCustomerEmailLinks({ publicSlug: "studio-fictief", bookingToken: TOKEN });
    expect(l.bookingUrl).toBe("https://glowsuite.nl/boeken/studio-fictief");
    expect(l.manageUrl).toBe(`https://glowsuite.nl/mijn-afspraak/${TOKEN}`);
  });
  it("salon without hyphen in slug", () => {
    expect(buildCustomerEmailLinks({ publicSlug: "studiofictief" }).bookingUrl).toBe("https://glowsuite.nl/boeken/studiofictief");
  });
  it("all links point to existing routes on the main domain, no subdomains", () => {
    const l = buildCustomerEmailLinks({ publicSlug: "studio-fictief", bookingToken: TOKEN });
    for (const u of [l.bookingUrl!, l.manageUrl!]) {
      expect(new URL(u).host).toBe("glowsuite.nl");
      expect(routeExists(u)).toBe(true);
      expect(isAllowedCustomerUrl(u)).toBe(true);
    }
  });
  it("calendar button hidden until an approved endpoint exists", () => {
    expect(buildCustomerEmailLinks({ publicSlug: "studio-fictief", bookingToken: TOKEN }).calendarUrl).toBeUndefined();
  });
  it("no manage link without a valid booking token (never appointment id or 'beheer')", () => {
    expect(buildCustomerEmailLinks({ publicSlug: "x", bookingToken: "beheer" }).manageUrl).toBeUndefined();
    expect(buildCustomerEmailLinks({ publicSlug: "x", bookingToken: "12345" }).manageUrl).toBeUndefined();
  });
  it("no booking link without a valid stored public_slug", () => {
    expect(buildCustomerEmailLinks({ publicSlug: null }).bookingUrl).toBeUndefined();
    expect(buildCustomerEmailLinks({ publicSlug: "Studio Fictief" }).bookingUrl).toBeUndefined();
  });
  it("rejects old subdomain, .ics and foreign links", () => {
    expect(isAllowedCustomerUrl("https://studio-fictief.glowsuite.nl/afspraak/beheer")).toBe(false);
    expect(isAllowedCustomerUrl("https://studiofictief.glowsuite.nl/calendar/x/booking_confirmation.ics")).toBe(false);
    expect(isAllowedCustomerUrl("https://evil.example/boeken/studio-fictief")).toBe(false);
    expect(isAllowedCustomerUrl("http://glowsuite.nl/route-contact")).toBe(false);
  });
  it("rebook link must be the same salon's booking page", () => {
    expect(isSalonBookingUrl("https://glowsuite.nl/boeken/studio-fictief?rebook=1", "studio-fictief")).toBe(true);
    expect(isSalonBookingUrl("https://glowsuite.nl/boeken/andere-salon", "studio-fictief")).toBe(false);
  });
  it("preview and final email get identical links (same inputs, no preview flag)", () => {
    const a = buildCustomerEmailLinks({ publicSlug: "studio-fictief", bookingToken: TOKEN });
    const b = buildCustomerEmailLinks({ publicSlug: "studio-fictief", bookingToken: TOKEN });
    expect(a).toEqual(b);
  });
});

describe("ics builder (offline)", () => {
  const ics = buildIcs({ uid: `${TOKEN}@glowsuite.nl`, date: "2026-10-24", time: "10:00", durationMinutes: 60, summary: "Gezichtsbehandeling, Studio Fictief", now: new Date(Date.UTC(2026, 9, 10, 12)) });
  it("correct local date, time and timezone", () => {
    expect(ics).toContain("DTSTART;TZID=Europe/Amsterdam:20261024T100000");
    expect(ics).toContain("DTEND;TZID=Europe/Amsterdam:20261024T110000");
    expect(ics).toContain("TZID:Europe/Amsterdam");
    expect(ics).toContain("SUMMARY:Gezichtsbehandeling\\, Studio Fictief");
  });
  it("across midnight and on DST change day", () => {
    expect(buildIcs({ uid: "u", date: "2026-10-25", time: "23:30", durationMinutes: 60, summary: "x" })).toContain("DTEND;TZID=Europe/Amsterdam:20261026T003000");
  });
  it("rejects invalid input", () => {
    expect(() => buildIcs({ uid: "u", date: "2026-02-30", time: "10:00", durationMinutes: 60, summary: "x" })).toThrow();
    expect(() => buildIcs({ uid: "u", date: "2026-10-24", time: "25:00", durationMinutes: 60, summary: "x" })).toThrow();
    expect(() => buildIcs({ uid: "u", date: "2026-10-24", time: "10:00", durationMinutes: 0, summary: "x" })).toThrow();
  });
});

describe("email authorization (existing emailSendAuth, fictieve salons)", () => {
  const deps = {
    serviceRoleKey: "svc-fictief",
    verifyUser: async (j: string) => (j === "jwt-a" ? "user-a" : null),
    tenantForUser: async () => "salon-a",
    rolesForUser: async () => ["eigenaar"],
  };
  it("other salon via user_id is refused, preview or send", async () => {
    expect((await authorizeEmailRequest("Bearer jwt-a", "salon-b", deps)).ok).toBe(false);
  });
  it("internal automations keep working", async () => {
    expect(await authorizeEmailRequest("Bearer svc-fictief", "salon-b", deps)).toMatchObject({ ok: true, caller: "service" });
  });
});
