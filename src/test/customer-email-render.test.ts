import { describe, expect, it } from "vitest";
import {
  allowedLinksIn, buildSafeEmailLinks, customerEmailPaused, templateActions, TEMPLATE_KEYS,
} from "../../supabase/functions/_shared/inactive/customerEmailRender";
import { isAllowedCustomerUrl } from "../../supabase/functions/_shared/inactive/emailLinks";

const TOKEN = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const APPT_ID = "9a9a9a9a-0000-4000-8000-000000000001";
const full = buildSafeEmailLinks({ publicSlug: "studio-fictief", bookingToken: TOKEN, storedReviewUrl: "https://g.page/r/fictief/review" });
const empty = buildSafeEmailLinks({ publicSlug: null, bookingToken: undefined, storedReviewUrl: null });

describe("customer email render links (inactive, fictief)", () => {
  it("never produces /afspraak/beheer, subdomains or .ics", () => {
    for (const k of TEMPLATE_KEYS) for (const l of [full, empty]) {
      for (const url of allowedLinksIn(templateActions(k, l))) {
        expect(url).not.toMatch(/afspraak\/beheer|\.ics|\/\/[a-z0-9-]+\.glowsuite\.nl/);
      }
    }
  });
  it("hides buttons when destination is missing", () => {
    for (const k of TEMPLATE_KEYS) {
      if (k === "review_request") continue;
      const a = templateActions(k, empty);
      expect(a.primary).toBeUndefined();
      expect(a.secondary).toBeUndefined();
      expect(a.confirmFlow).toBeUndefined();
    }
  });
  it("calendar, route and terms are never shown", () => {
    for (const k of TEMPLATE_KEYS) expect(templateActions(k, full)).toMatchObject({ showCalendar: false, showTerms: false, showRoute: false });
  });
  it("appointment id is never accepted as token when it is not the booking_token", () => {
    const l = buildSafeEmailLinks({ publicSlug: "studio-fictief", bookingToken: `appt-${APPT_ID}` });
    expect(l.manageUrl).toBeUndefined();
    expect(l.confirmUrl).toBeUndefined();
  });
  it("reminder confirm/decline use existing token routes", () => {
    const a = templateActions("appointment_reminder", full);
    expect(a.confirmFlow).toEqual({
      confirmUrl: `https://glowsuite.nl/afspraak/${TOKEN}/bevestigen`,
      declineUrl: `https://glowsuite.nl/afspraak/${TOKEN}/annuleren`,
    });
    expect(isAllowedCustomerUrl(a.confirmFlow!.confirmUrl)).toBe(true);
    expect(isAllowedCustomerUrl(a.confirmFlow!.declineUrl)).toBe(true);
  });
  it("payment receipt shows no placeholder receipt page", () => {
    const a = templateActions("payment_receipt", full);
    expect(allowedLinksIn(a).some((u) => u.includes("/betaalbewijs"))).toBe(false);
    expect(a.primary?.url).toBe(`https://glowsuite.nl/mijn-afspraak/${TOKEN}`);
  });
  it("membership goes to the salon's own membership portal", () => {
    expect(templateActions("membership_notification", full).primary?.url).toBe("https://glowsuite.nl/abonnementen/studio-fictief");
  });
  it("review link only from stored https value", () => {
    expect(buildSafeEmailLinks({ publicSlug: "x", storedReviewUrl: "javascript:alert(1)" }).reviewUrl).toBeUndefined();
    expect(buildSafeEmailLinks({ publicSlug: "x", storedReviewUrl: "http://g.page/r" }).reviewUrl).toBeUndefined();
    expect(buildSafeEmailLinks({ publicSlug: "x", storedReviewUrl: "https://u:p@g.page/r" }).reviewUrl).toBeUndefined();
  });
  it("all internal links pass the main-domain allowlist", () => {
    for (const k of TEMPLATE_KEYS) for (const u of allowedLinksIn(templateActions(k, full))) {
      if (u.startsWith("https://glowsuite.nl/")) expect(isAllowedCustomerUrl(u) || u.includes("/abonnementen/")).toBe(true);
    }
  });
  it("pause switch only on explicit true", () => {
    expect(customerEmailPaused("true")).toBe(true);
    expect(customerEmailPaused(" TRUE ")).toBe(true);
    expect(customerEmailPaused(undefined)).toBe(false);
    expect(customerEmailPaused("yes")).toBe(false);
  });
});
