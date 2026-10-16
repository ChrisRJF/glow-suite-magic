import { describe, it, expect } from "vitest";
import { liveCreateAccess, liveContactEmail, LIVE_CREATE_MAX_ATTEMPTS_PER_HOUR } from "../../supabase/functions/_shared/inactive/isvLiveAccess";

const ok = { sessionUserId: "u", emailConfirmed: true, isOwner: true, settingsFound: true, isDemo: false, salonName: "Salon", recentAttempts: 0 };
describe("GA live create access (no pilot list)", () => {
  it("any real confirmed owner with setup is allowed", () => expect(liveCreateAccess(ok).ok).toBe(true));
  it("unknown facts fail closed", () => expect(liveCreateAccess(null)).toEqual({ ok: false, status: 503, error: "unavailable" }));
  it("demo refused", () => expect(liveCreateAccess({ ...ok, isDemo: true })).toMatchObject({ error: "demo_account" }));
  it("non-owner refused", () => expect(liveCreateAccess({ ...ok, isOwner: false })).toMatchObject({ error: "owner_required" }));
  it("unconfirmed email refused", () => expect(liveCreateAccess({ ...ok, emailConfirmed: false })).toMatchObject({ error: "email_not_confirmed" }));
  it("no salon name refused", () => expect(liveCreateAccess({ ...ok, salonName: " " })).toMatchObject({ error: "salon_name_required" }));
  it("3 attempts per hour max", () => {
    expect(LIVE_CREATE_MAX_ATTEMPTS_PER_HOUR).toBe(3);
    expect(liveCreateAccess({ ...ok, recentAttempts: 3 })).toMatchObject({ status: 429 });
    expect(liveCreateAccess({ ...ok, recentAttempts: 2 }).ok).toBe(true);
  });
  it("contact email is the auth email only", () => expect(liveContactEmail("  a@b.nl ")).toBe("a@b.nl"));
});
