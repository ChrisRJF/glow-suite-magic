import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { bookingConfirmationManageAction, currentActiveManageUrl, renderPrimaryCta } from "../../docs/prepared-patches/manual-booking-confirmation/bookingConfirmationManageAction";
import { dispatchManualConfirmation, type Deps } from "../../docs/prepared-patches/manual-booking-confirmation/manualConfirmationCore";

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const apt = {
  id: "apt-1", user_id: T, is_demo: false, status: "gepland", source: "manual", customer_id: "c1", service_id: "s1",
  appointment_date: "2026-10-16T22:30:00+00:00", start_time: "00:30", end_time: "01:30", booking_token: null as string | null,
  booking_reference: "GS-FICTIEF1", payment_status: "unpaid",
};

function mk(over: Partial<Deps> = {}, a: any = apt) {
  const claimed = new Set<string>();
  const send = vi.fn().mockResolvedValue({ ok: true });
  const payments = vi.fn();
  const deps: Deps = {
    verifyUser: async (j) => (j === "jwt-ok" ? "u1" : null),
    tenantForUser: async () => ({ tenantId: T, isDemo: false }),
    rolesForUser: async () => ["eigenaar"],
    loadAppointment: async (tid, id) => (tid === a.user_id && id === a.id ? a : null),
    loadEmployeeLinks: async () => [{ employee_id: "e1", is_primary: true, name: "Fictief Marie" }],
    loadCustomer: async () => ({ name: "Test Klant", email: "test@voorbeeld.test", language: "nl" }),
    loadService: async () => ({ name: "Fictieve behandeling" }),
    loadSalon: async () => ({ salon_name: "Fictieve Salon", public_slug: "fictieve-salon", demo_mode: false, is_demo: false }),
    emailAllowed: async () => true,
    sendingAllowed: async () => true,
    claim: async (k) => (claimed.has(k) ? false : (claimed.add(k), true)),
    release: async (k) => { claimed.delete(k); },
    send,
    rendererTokenOnlyManageLink: true,
    allowedRecipients: new Set(["test@voorbeeld.test"]),
    ...over,
  };
  return { deps, send, payments };
}
const req = { jwt: "jwt-ok", appointmentId: "apt-1", sendToCustomer: true };

describe("manual booking confirmation (fictional salons, mocks only)", () => {
  it("success: one mail, Amsterdam time, salon data, no invented manage link", async () => {
    const { deps, send } = mk();
    expect(await dispatchManualConfirmation(req, deps)).toEqual({ sent: true, key: "manual-booking-confirmation-apt-1" });
    const p = send.mock.calls[0][0];
    expect(p).toMatchObject({ template_key: "booking_confirmation", user_id: T, recipient_email: "test@voorbeeld.test" });
    expect(p.template_data).toMatchObject({ date: "2026-10-17", time: "00:30", service_name: "Fictieve behandeling", employee: "Fictief Marie" });
    expect(p.template_data.manage_url).toBeUndefined();
  });
  it("valid token gives the safe Mijn afspraak link", async () => {
    const { deps, send } = mk({}, { ...apt, booking_token: TOKEN });
    await dispatchManualConfirmation(req, deps);
    expect(send.mock.calls[0][0].template_data.manage_url).toBe(`https://glowsuite.nl/mijn-afspraak/${TOKEN}`);
  });
  it("choice off = nothing", async () => {
    const { deps, send } = mk();
    expect(await dispatchManualConfirmation({ ...req, sendToCustomer: false }, deps)).toEqual({ sent: false, reason: "not_requested" });
    expect(send).not.toHaveBeenCalled();
  });
  it("incomplete or cancelled appointment = no mail", async () => {
    for (const a of [{ ...apt, end_time: null }, { ...apt, customer_id: null }, { ...apt, status: "geannuleerd" }]) {
      const { deps, send } = mk({}, a);
      expect((await dispatchManualConfirmation(req, deps)).sent).toBe(false);
      expect(send).not.toHaveBeenCalled();
    }
  });
  it("no email, opted out, paused, demo = no mail", async () => {
    const cases: Partial<Deps>[] = [
      { loadCustomer: async () => ({ name: "X", email: "", language: null }) },
      { emailAllowed: async () => false },
      { sendingAllowed: async () => false },
      { sendingAllowed: async () => { throw new Error("read"); } },
      { loadSalon: async () => ({ salon_name: "D", public_slug: "d", demo_mode: true, is_demo: false }) },
    ];
    for (const c of cases) { const { deps, send } = mk(c); expect((await dispatchManualConfirmation(req, deps)).sent).toBe(false); expect(send).not.toHaveBeenCalled(); }
    const demo = mk({ tenantForUser: async () => ({ tenantId: T, isDemo: true }) }, { ...apt, is_demo: true });
    expect(await dispatchManualConfirmation(req, demo.deps)).toEqual({ sent: false, reason: "demo" });
  });
  it("double click / retry sends once", async () => {
    const { deps, send } = mk();
    const [a, b] = await Promise.all([dispatchManualConfirmation(req, deps), dispatchManualConfirmation(req, deps)]);
    expect([a.sent, b.sent].sort()).toEqual([false, true]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("other salon, no login or wrong role = no mail", async () => {
    for (const c of [
      { tenantForUser: async () => ({ tenantId: "other", isDemo: false }) },
      { rolesForUser: async () => ["medewerker"] },
      { rolesForUser: async () => null },
    ] as Partial<Deps>[]) { const { deps, send } = mk(c); expect((await dispatchManualConfirmation(req, deps)).sent).toBe(false); expect(send).not.toHaveBeenCalled(); }
    const { deps } = mk();
    expect(await dispatchManualConfirmation({ ...req, jwt: null }, deps)).toEqual({ sent: false, reason: "not_authenticated" });
  });
  it("old wall-clock row: time not guessed, no mail", async () => {
    const { deps, send } = mk({}, { ...apt, appointment_date: "2026-10-16T23:30:00+00:00", start_time: "23:30" });
    expect(await dispatchManualConfirmation(req, deps)).toEqual({ sent: false, reason: "unknown_time" });
    expect(send).not.toHaveBeenCalled();
  });
  it("failed send releases the claim; payments are never touched", async () => {
    const { deps, payments } = mk({ send: vi.fn().mockResolvedValue({ ok: false }) });
    expect(await dispatchManualConfirmation(req, deps)).toEqual({ sent: false, reason: "send_failed" });
    expect(await deps.claim("manual-booking-confirmation-apt-1")).toBe(true);
    expect(payments).not.toHaveBeenCalled();
    expect(Object.keys(deps).some((k) => /pay/i.test(k))).toBe(false);
  });

  it("only source=manual with allowed status/payment state gets mail", async () => {
    const bad: [any, string][] = [
      [{ source: "online_booking" }, "not_manual"], [{ source: "public_booking" }, "not_manual"],
      [{ source: "auto_rebook" }, "not_manual"], [{ source: null }, "not_manual"],
      [{ status: "cancelled" }, "cancelled"], [{ status: "Geannuleerd" }, "cancelled"],
      [{ status: "no_show" }, "status_not_allowed"], [{ status: "no-show" }, "status_not_allowed"],
      [{ status: "pending_confirmation" }, "status_not_allowed"], [{ status: "voltooid" }, "status_not_allowed"],
      [{ payment_status: "pending" }, "payment_not_allowed"], [{ payment_status: "failed" }, "payment_not_allowed"],
      [{ payment_status: "expired" }, "payment_not_allowed"], [{ payment_status: "open" }, "payment_not_allowed"],
    ];
    for (const [o, reason] of bad) {
      const { deps, send } = mk({}, { ...apt, ...o });
      expect(await dispatchManualConfirmation(req, deps)).toEqual({ sent: false, reason });
      expect(send).not.toHaveBeenCalled();
    }
  });
  it("renderer without token-only patch = fail closed, no mail", async () => {
    const { deps, send } = mk({ rendererTokenOnlyManageLink: false });
    expect(await dispatchManualConfirmation(req, deps)).toEqual({ sent: false, reason: "renderer_unsafe" });
    expect(send).not.toHaveBeenCalled();
  });
  it("same From as public confirmation: public_slug, no legacy sender flag", async () => {
    const { deps, send } = mk();
    await dispatchManualConfirmation(req, deps);
    const p = send.mock.calls[0][0];
    expect(p.salon_slug).toBe("fictieve-salon");
    expect(p).not.toHaveProperty("sender_legacy_name_id");
  });
  it("rendered CTA: active renderer invents /afspraak/beheer; patched renderer shows no button without token", async () => {
    const base = "https://fictieve-salon.glowsuite.nl";
    expect(renderPrimaryCta({ label: "Beheer", url: currentActiveManageUrl({}, base) })).toContain("/afspraak/beheer");
    const active = readFileSync("supabase/functions/send-white-label-email/index.ts", "utf8");
    expect(active).toContain('"/afspraak/beheer"'); // gap still live -> activation blocked until template diff deploys
    const { deps, send } = mk();
    await dispatchManualConfirmation(req, deps);
    const html = renderPrimaryCta(bookingConfirmationManageAction(send.mock.calls[0][0].template_data, "Beheer"));
    expect(html).toBe("");
    for (const fake of ["/afspraak/beheer", `${base}/afspraak/beheer`, "https://glowsuite.nl/mijn-afspraak/niet-een-uuid", `https://evil.test/mijn-afspraak/${TOKEN}`])
      expect(renderPrimaryCta(bookingConfirmationManageAction({ manage_url: fake }, "Beheer"))).toBe("");
  });
  it("rendered CTA with valid token = existing glowsuite.nl/mijn-afspraak/uuid", async () => {
    const { deps, send } = mk({}, { ...apt, booking_token: TOKEN });
    await dispatchManualConfirmation(req, deps);
    const html = renderPrimaryCta(bookingConfirmationManageAction(send.mock.calls[0][0].template_data, "Beheer"));
    expect(html).toContain(`href="https://glowsuite.nl/mijn-afspraak/${TOKEN}"`);
    expect(html).not.toContain("/afspraak/beheer");
  });
});
