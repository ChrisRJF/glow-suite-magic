import { describe, it, expect, vi } from "vitest";
import { processOutbox, type WorkerDeps, type OutboxRow } from "../../docs/prepared-patches/manual-booking-confirmation/manualConfirmationWorker";
import { buildCreateBody } from "../../src/lib/agendaCreateClient";

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const baseApt = {
  id: "apt-1", user_id: T, is_demo: false, status: "gepland", source: "manual", customer_id: "c1", service_id: "s1",
  appointment_date: "2026-10-16T08:30:00+00:00", start_time: "10:30", end_time: "11:30", booking_token: null as string | null,
  booking_reference: "GS-FICTIEF1", payment_status: "unpaid",
};

function mk(opts: { apt?: any; core?: Partial<WorkerDeps["core"]>; demo?: boolean | null; rows?: OutboxRow[] } = {}) {
  const apt = opts.apt ?? baseApt;
  const send = vi.fn().mockResolvedValue({ ok: true });
  const finish = vi.fn().mockResolvedValue(true);
  const deps: WorkerDeps = {
    claim: async () => opts.rows ?? [{ appointment_id: apt.id, tenant_id: T, attempts: 1 }],
    finish,
    tenantIsDemo: async () => (opts.demo === undefined ? false : opts.demo),
    core: {
      loadAppointment: async (tid, id) => (tid === apt.user_id && id === apt.id ? apt : null),
      loadEmployeeLinks: async () => [{ employee_id: "e1", is_primary: true, name: "Fictief Marie" }],
      loadCustomer: async () => ({ name: "Test Klant", email: "Test@Voorbeeld.test", language: "nl" }),
      loadService: async () => ({ name: "Fictieve behandeling" }),
      loadSalon: async () => ({ salon_name: "Fictieve Salon", public_slug: "fictieve-salon", demo_mode: false, is_demo: false }),
      emailAllowed: async () => true,
      sendingAllowed: async () => true,
      send,
      rendererTokenOnlyManageLink: true,
      allowedRecipients: new Set(["test@voorbeeld.test"]),
      ...opts.core,
    },
  };
  return { deps, send, finish };
}

describe("manual confirmation outbox worker (fictional data, mocks only)", () => {
  it("sends once via booking_confirmation with Amsterdam time and the stable idempotency key", async () => {
    const { deps, send, finish } = mk();
    expect(await processOutbox(deps)).toEqual({ sent: 1, skipped: 0, retry: 0 });
    const p = send.mock.calls[0][0];
    expect(p.template_key).toBe("booking_confirmation");
    expect(p.idempotency_key).toBe("manual-booking-confirmation-apt-1");
    expect(p.recipient_email).toBe("test@voorbeeld.test");
    expect(p.template_data).toMatchObject({ date: "2026-10-16", time: "10:30", service_name: "Fictieve behandeling", employee: "Fictief Marie" });
    expect(finish).toHaveBeenCalledWith("apt-1", 1, "sent", "sent");
  });

  it("retry after a lost send reuses exactly the same idempotency key", async () => {
    const a = mk({ core: { send: vi.fn().mockResolvedValue({ ok: false }) } });
    expect(await processOutbox(a.deps)).toEqual({ sent: 0, skipped: 0, retry: 1 });
    expect(a.finish).toHaveBeenCalledWith("apt-1", 1, "retry", "send_failed");
    const b = mk({ rows: [{ appointment_id: "apt-1", tenant_id: T, attempts: 2 }] });
    await processOutbox(b.deps);
    expect(b.send.mock.calls[0][0].idempotency_key).toBe("manual-booking-confirmation-apt-1");
  });

  it("address not on the test allow-list: no mail, final skip", async () => {
    const { deps, send, finish } = mk({ core: { loadCustomer: async () => ({ name: "X", email: "echt@klant.nl", language: "nl" }) } });
    await processOutbox(deps);
    expect(send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith("apt-1", 1, "skipped", "recipient_not_allowed");
  });

  it("empty allow-list sends to nobody (fail closed)", async () => {
    const { deps, send } = mk({ core: { allowedRecipients: new Set() } });
    await processOutbox(deps); expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["demo salon", { core: { loadSalon: async () => ({ salon_name: "S", public_slug: "s", demo_mode: true, is_demo: false }) } }, "demo"],
    ["opted out", { core: { emailAllowed: async () => false } }, "opted_out"],
    ["consent read fails", { core: { emailAllowed: async () => { throw new Error("x"); } } }, "opted_out"],
    ["no email", { core: { loadCustomer: async () => ({ name: "X", email: "", language: "nl" }) } }, "no_email"],
    ["other salon", { rows: [{ appointment_id: "apt-1", tenant_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", attempts: 1 }] }, "not_found"],
    ["not manual", { apt: { ...baseApt, source: "online" } }, "not_manual"],
    ["renderer still invents a manage link", { core: { rendererTokenOnlyManageLink: false } }, "renderer_unsafe"],
  ])("%s: no mail", async (_n, o: any, reason) => {
    const { deps, send, finish } = mk(o);
    await processOutbox(deps);
    expect(send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith("apt-1", 1, "skipped", reason);
  });

  it("stop switch on: retried later, not dropped", async () => {
    const { deps, send, finish } = mk({ core: { sendingAllowed: async () => false } });
    await processOutbox(deps);
    expect(send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith("apt-1", 1, "retry", "paused");
  });

  it("manage link only with a valid booking token, never invented", async () => {
    const without = mk(); await processOutbox(without.deps);
    expect(without.send.mock.calls[0][0].template_data.manage_url).toBeUndefined();
    const withTok = mk({ apt: { ...baseApt, booking_token: TOKEN } }); await processOutbox(withTok.deps);
    expect(withTok.send.mock.calls[0][0].template_data.manage_url).toBe(`https://glowsuite.nl/mijn-afspraak/${TOKEN}`);
  });

  it("unreadable salon state: retry, no mail", async () => {
    const { deps, send, finish } = mk({ demo: null });
    await processOutbox(deps);
    expect(send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith("apt-1", 1, "retry", "tenant_unreadable");
  });
});

describe("form choice in the create request", () => {
  const f = { customer_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", service_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", date: "2026-10-16", time: "10:30", employee_ids: [], group: [] };
  it("stays false while the UI switch is off, even when asked", () => {
    const r = buildCreateBody("ffffffff-ffff-4fff-8fff-ffffffffffff", { ...f, send_confirmation: true });
    expect(r.ok && r.body.send_confirmation).toBe(false);
  });
  it("is true only when the switch is enabled and the user chose it", () => {
    const on = buildCreateBody("ffffffff-ffff-4fff-8fff-ffffffffffff", { ...f, send_confirmation: true }, { uiEnabled: true });
    const off = buildCreateBody("ffffffff-ffff-4fff-8fff-ffffffffffff", { ...f, send_confirmation: false }, { uiEnabled: true });
    expect(on.ok && on.body.send_confirmation).toBe(true);
    expect(off.ok && off.body.send_confirmation).toBe(false);
  });
});
