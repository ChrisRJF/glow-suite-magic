import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareCustomerEmail } from "../../supabase/functions/_shared/inactive/customerEmailPrepare";

const TOKEN = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const SVC = "svc-fictief";
const slugs: Record<string, string | null> = { "salon-a": "studio-fictief", "salon-b": "salon-andere", "salon-c": null };
const deps = {
  serviceRoleKey: SVC,
  verifyUser: async (j: string) => ({ "jwt-owner-a": "u-a", "jwt-staff-a": "u-s" } as Record<string, string>)[j] ?? null,
  tenantForUser: async () => "salon-a",
  rolesForUser: async (u: string) => (u === "u-a" ? ["eigenaar"] : ["medewerker"]),
  publicSlugForTenant: async (t: string) => slugs[t] ?? null,
};
// Mock of appointment-confirm "portal": looks up by booking_token only.
const appointments = [{ id: "appt-1", booking_token: TOKEN, user_id: "salon-a" }];
const portal = (token: string) => appointments.find((a) => a.booking_token === token) ?? null;

const booking = (extra: Record<string, unknown> = {}) => ({
  user_id: "salon-a",
  template_data: { booking_token: TOKEN, salon_slug: "evil", manage_url: "https://evil.example", calendar_url: "https://studio-fictief.glowsuite.nl/x.ics", contact_url: "https://glowsuite.nl/route-contact", ...extra },
});

describe("booking confirmation + reminder chain (fictief)", () => {
  it("salon from stored public_slug, caller slug ignored; rebook to own booking page", async () => {
    const r = await prepareCustomerEmail(`Bearer ${SVC}`, booking(), deps);
    expect(r.ok && r.links.bookingUrl).toBe("https://glowsuite.nl/boeken/studio-fictief");
  });
  it("manage link uses booking_token and the portal lookup accepts it", async () => {
    const r = await prepareCustomerEmail(`Bearer ${SVC}`, booking(), deps);
    if (!r.ok) throw new Error();
    const token = new URL(r.links.manageUrl!).pathname.split("/").pop()!;
    expect(r.links.manageUrl).toBe(`https://glowsuite.nl/mijn-afspraak/${TOKEN}`);
    expect(portal(token)?.id).toBe("appt-1");
    const src = readFileSync("supabase/functions/appointment-confirm/index.ts", "utf8");
    expect(src).toMatch(/\.eq\("booking_token", parsed\.data\.token\)/);
    expect(readFileSync("src/App.tsx", "utf8")).toContain('path="/mijn-afspraak/:token"');
  });
  it.each([undefined, "", "beheer", "appt-1", "12345"])("no manage button for token %s", async (t) => {
    const r = await prepareCustomerEmail(`Bearer ${SVC}`, booking({ booking_token: t }), deps);
    expect(r.ok && r.links.manageUrl).toBeUndefined();
  });
  it("no .ics, no generic route/terms presented as salon-specific", async () => {
    const r = await prepareCustomerEmail(`Bearer ${SVC}`, booking(), deps);
    if (!r.ok) throw new Error();
    expect(r.links.calendarUrl).toBeUndefined();
    expect(r.links.contactUrl).toBeUndefined();
    expect(r.links.termsUrl).toBeUndefined();
    expect(JSON.stringify(r.links)).not.toMatch(/\.ics|evil|route-contact|salonvoorwaarden|\.glowsuite\.nl/);
  });
  it("salon without public_slug gets no booking button", async () => {
    const r = await prepareCustomerEmail(`Bearer ${SVC}`, { user_id: "salon-c", template_data: { booking_token: TOKEN } }, deps);
    expect(r.ok && r.links.bookingUrl).toBeUndefined();
  });
  it("owner of salon A cannot send or preview for salon B", async () => {
    expect(await prepareCustomerEmail("Bearer jwt-owner-a", { ...booking(), user_id: "salon-b" }, deps)).toMatchObject({ ok: false, status: 403 });
  });
  it("employee role, bad jwt, no header are refused", async () => {
    expect((await prepareCustomerEmail("Bearer jwt-staff-a", booking(), deps)).ok).toBe(false);
    expect((await prepareCustomerEmail("Bearer nope", booking(), deps)).ok).toBe(false);
    expect((await prepareCustomerEmail(null, booking(), deps)).ok).toBe(false);
  });
  it("public-booking and automation-scheduler (service key) keep working for any salon", async () => {
    expect(await prepareCustomerEmail(`Bearer ${SVC}`, { ...booking(), user_id: "salon-b" }, deps)).toMatchObject({ ok: true, caller: "service" });
    for (const f of ["public-booking", "automation-scheduler"]) {
      const src = readFileSync(`supabase/functions/${f}/index.ts`, "utf8");
      expect(src).toContain('functions.invoke("send-white-label-email"');
      expect(src).toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
  });
  it("admin preview (owner JWT) and real send produce identical links", async () => {
    const a = await prepareCustomerEmail("Bearer jwt-owner-a", { ...booking(), preview_only: true }, deps);
    const b = await prepareCustomerEmail(`Bearer ${SVC}`, booking(), deps);
    expect(a.ok && b.ok && a.links).toEqual(b.ok && b.links);
  });
  it("settings lookup failure fails closed", async () => {
    const r = await prepareCustomerEmail(`Bearer ${SVC}`, booking(), { ...deps, publicSlugForTenant: async () => { throw new Error(); } });
    expect(r).toMatchObject({ ok: false, status: 500 });
  });
});
