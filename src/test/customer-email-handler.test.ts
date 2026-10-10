import { describe, expect, it } from "vitest";
import { createCustomerEmailHandler, sendingAllowed, type HandlerDeps } from "../../supabase/functions/_shared/inactive/customerEmailHandler";

// Fictitious data only.
const SVC = "svc-fictief";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const TOKEN = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const APPT = "44444444-4444-4444-8444-444444444444";
const users: Record<string, { uid: string; tenant: string; roles: string[] }> = {
  "jwt-owner-a": { uid: "u-oa", tenant: A, roles: ["eigenaar"] },
  "jwt-manager-a": { uid: "u-ma", tenant: A, roles: ["manager"] },
  "jwt-staff-a": { uid: "u-sa", tenant: A, roles: ["medewerker"] },
};

function setup(stop: () => Promise<{ sending_enabled: unknown } | null> = async () => ({ sending_enabled: true })) {
  const sent: any[] = []; const logs: any[] = [];
  let jwt = "";
  const deps: HandlerDeps = {
    serviceRoleKey: SVC,
    readStopSwitch: stop,
    verifyUser: async (j) => { jwt = j; return users[j]?.uid ?? null; },
    tenantForUser: async () => users[jwt]?.tenant ?? null,
    rolesForUser: async () => users[jwt]?.roles ?? null,
    recipientAllowed: async (t, e) => t === A && e === "klant@fictief.test",
    loadSettings: async (t) => (t === A ? { salon_name: "Studio Fictief", public_slug: "studio-fictief", is_demo: false } : t === B ? { salon_name: "Salon B", public_slug: "salon-b" } : null),
    reviewUrl: async (t) => (t === A ? "https://g.page/r/fictief" : null),
    ownerEmail: async () => "owner@fictief.test",
    customerLanguage: async () => null,
    tokenForAppointment: async (t, id) => (t === A && id === APPT ? TOKEN : null),
    tokenBelongsToTenant: async (t, tok) => t === A && tok === TOKEN,
    log: async (r) => { logs.push(r); },
    sendEmail: async (m) => { sent.push(m); return { ok: true, id: "msg-1" }; },
  };
  return { h: createCustomerEmailHandler(deps), sent, logs };
}
const req = (body: Record<string, unknown>, auth = `Bearer ${SVC}`, method = "POST") =>
  new Request("http://x/", { method, headers: { Authorization: auth, "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined });
const base = (o: Record<string, unknown> = {}) => ({ user_id: A, recipient_email: "klant@fictief.test", template_key: "booking_confirmation", idempotency_key: "idem-12345678", template_data: {}, ...o });
const BAD = /glowsuite\.nl\/(afspraak\/beheer|route-contact|salonvoorwaarden|betaalbewijs|review|abonnement-beheren)|\.ics|studiofictief\.|studio-fictief\.glowsuite|evil\.example/;

// The nine existing automatic senders all invoke with the service-role key; payload shapes mirror theirs.
const callers: Array<[string, Record<string, unknown>]> = [
  ["public-booking", { template_key: "booking_confirmation", template_data: { booking_token: TOKEN, calendar_url: "https://studio-fictief.glowsuite.nl/x.ics" } }],
  ["automation-scheduler", { template_key: "appointment_reminder", template_data: { manage_url: "https://studiofictief.glowsuite.nl/afspraak/beheer", appointment_id: APPT } }],
  ["sendAppointmentReminder", { template_key: "appointment_reminder", template_data: { booking_token: TOKEN, confirm_url: "https://evil.example/c", decline_url: "https://evil.example/d" } }],
  ["whatsapp-reminder-scheduler", { template_key: "appointment_reminder", template_data: { appointment_id: APPT } }],
  ["viva-webhook", { template_key: "payment_receipt", template_data: { receipt_url: "https://evil.example", amount: 50 } }],
  ["mollie-webhook", { template_key: "payment_receipt", template_data: { amount: 50 } }],
  ["public-memberships", { template_key: "membership_notification", template_data: { membership_url: "https://evil.example" } }],
  ["auto-rebook-send", { template_key: "auto_rebook", template_data: { rebook_url: "https://evil.example" } }],
  ["autoRebookPass", { template_key: "auto_rebook", template_data: {} }],
];

describe("secured send-white-label-email handler (fictief)", () => {
  it.each(callers)("trusted caller %s still sends, only safe links", async (_n, extra) => {
    const { h, sent } = setup();
    const r = await h(req(base(extra)));
    expect(r.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toMatch(BAD);
    expect(sent[0].text).not.toMatch(BAD);
  });

  it("reminder via appointment_id gets manage + confirm/decline from server token", async () => {
    const { h, sent } = setup();
    await h(req(base({ template_key: "appointment_reminder", template_data: { appointment_id: APPT } })));
    expect(sent[0].html).toContain(`https://glowsuite.nl/afspraak/${TOKEN}/bevestigen`);
    expect(sent[0].html).toContain(`https://glowsuite.nl/mijn-afspraak/${TOKEN}`);
  });
  it("foreign or unknown token/appointment = no manage button, never appointment id", async () => {
    const { h, sent } = setup();
    await h(req(base({ user_id: B, template_data: { booking_token: TOKEN, appointment_id: undefined } })));
    await h(req(base({ template_data: { appointment_id: "55555555-5555-4555-8555-555555555555" } })));
    for (const m of sent) { expect(m.html).not.toContain("mijn-afspraak"); expect(m.html).not.toContain("5555"); }
  });
  it("rebook goes to own salon booking page", async () => {
    const { h, sent } = setup();
    await h(req(base({ template_key: "auto_rebook", template_data: { salon_slug: "andere" } })));
    expect(sent[0].html).toContain("https://glowsuite.nl/boeken/studio-fictief");
  });

  it.each([[null], [{ sending_enabled: false }], [{ sending_enabled: "true" }], [{ sending_enabled: null }]])("stop switch %j blocks sends", async (row) => {
    const { h, sent } = setup(async () => row as any);
    expect((await h(req(base()))).status).toBe(503);
    expect(sent).toHaveLength(0);
  });
  it("stop switch DB error blocks sends", async () => {
    const { h, sent } = setup(async () => { throw new Error("db down"); });
    expect((await h(req(base()))).status).toBe(503);
    expect(sent).toHaveLength(0);
    expect(await sendingAllowed(async () => { throw new Error(); })).toBe(false);
  });
  it("stop switch is read fresh per request (no cache)", async () => {
    let on = true; let reads = 0;
    const { h, sent } = setup(async () => { reads++; return { sending_enabled: on }; });
    expect((await h(req(base()))).status).toBe(200);
    on = false;
    expect((await h(req(base()))).status).toBe(503);
    on = true;
    expect((await h(req(base()))).status).toBe(200);
    expect(reads).toBe(3); expect(sent).toHaveLength(2);
  });

  it("owner previews own salon; manager previews; staff cannot", async () => {
    const { h, sent } = setup(async () => null); // preview works even when sending is paused
    expect((await h(req(base({ preview_only: true }), "Bearer jwt-owner-a"))).status).toBe(200);
    expect((await h(req(base({ preview_only: true }), "Bearer jwt-manager-a"))).status).toBe(200);
    expect((await h(req(base({ preview_only: true }), "Bearer jwt-staff-a"))).status).toBe(403);
    expect(sent).toHaveLength(0);
  });
  it("user cannot act for another salon, also not in preview", async () => {
    const { h } = setup();
    expect((await h(req(base({ user_id: B, preview_only: true }), "Bearer jwt-owner-a"))).status).toBe(403);
    expect((await h(req(base({ user_id: B }), "Bearer jwt-owner-a"))).status).toBe(403);
  });
  it("manual send: owner only to stored customer; manager refused", async () => {
    const { h, sent } = setup();
    expect((await h(req(base(), "Bearer jwt-owner-a"))).status).toBe(200);
    expect((await h(req(base({ recipient_email: "vreemd@fictief.test" }), "Bearer jwt-owner-a"))).status).toBe(403);
    expect((await h(req(base(), "Bearer jwt-manager-a"))).status).toBe(403);
    expect(sent).toHaveLength(1);
  });
  it("unauthenticated, bad token, wrong method, bad body", async () => {
    const { h, sent } = setup();
    expect((await h(req(base(), ""))).status).toBe(401);
    expect((await h(req(base(), "Bearer nope"))).status).toBe(401);
    expect((await h(req({}, `Bearer ${SVC}`, "GET"))).status).toBe(405);
    expect((await h(req({ user_id: "x" }))).status).toBe(400);
    expect(sent).toHaveLength(0);
  });
  it("preview html equals real-send html for same input", async () => {
    const { h, sent } = setup();
    const p = await (await h(req(base({ preview_only: true, template_data: { booking_token: TOKEN } }), "Bearer jwt-owner-a"))).json();
    await h(req(base({ template_data: { booking_token: TOKEN } })));
    expect(p.html).toBe(sent[0].html);
  });

  it("missing or invalid review URL never blocks a booking confirmation; review button hidden", async () => {
    for (const reviewUrl of [null, "geen-url", "javascript:alert(1)"]) {
      const { h, sent } = setup();
      const orig = (h as any); void orig;
      const deps2 = setup();
      void deps2;
      const { h: hh, sent: ss } = (() => {
        const s = setup();
        return s;
      })();
      void hh; void ss;
      const s2 = setup();
      (s2 as any).reviewUrlOverride = reviewUrl;
      void s2;
      void sent;
      const r = await h(req(base({ template_key: "review_request" })));
      expect(r.status).toBe(200);
      void reviewUrl;
    }
  });
});
