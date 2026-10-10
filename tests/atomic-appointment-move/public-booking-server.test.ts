import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import { buildAtomicBookingArgs, interpretAtomicResult, OUTDATED_MSG } from "../../docs/prepared-patches/atomic-appointment-move/publicBookingAtomic";

const DIR = resolve(__dirname, "../../docs/prepared-patches/atomic-appointment-move");
const EA = "e0000000-0000-0000-0000-00000000000a";
const base = {
  slug: "salon-een", date: "2026-10-16", notes: "", depositTag: null, customerId: "c0000000-0000-0000-0000-000000000001",
  paymentRequired: false, paymentAmount: 0, paymentType: "deposit" as const, rebook: false,
  acceptedGlowsuiteTerms: true, acceptedSalonTerms: true, acceptedTermsAt: undefined, nowIso: "2026-10-10T20:00:00.000Z",
  rows: [{ name: "Test", time: "10:00", employee: EA, service: { id: "a0000000-0000-0000-0000-000000000060" } }],
};

describe("buildAtomicBookingArgs", () => {
  it("no stored public slug: refused (salon found by name only)", () => {
    expect(buildAtomicBookingArgs({ ...base, slug: null })).toBeNull();
    expect(buildAtomicBookingArgs({ ...base, slug: "" })).toBeNull();
  });
  it("employee name instead of UUID never sent", () => {
    expect(buildAtomicBookingArgs({ ...base, rows: [{ ...base.rows[0], employee: "Tino" }] })).toBeNull();
  });
  it("deposit and no deposit keep today's status values", () => {
    expect(buildAtomicBookingArgs(base)!._common).toMatchObject({ status: "confirmed", payment_status: "unpaid", payment_required: false, deposit_amount: 0 });
    const dep = buildAtomicBookingArgs({ ...base, paymentRequired: true, paymentAmount: 25, depositTag: "[deposit:new · risk=low/1]" })!;
    expect(dep._common).toMatchObject({ status: "pending_confirmation", payment_status: "pending", payment_required: true, deposit_amount: 25 });
    expect(dep._lines[0].notes).toBe("Online boeking · [deposit:new · risk=low/1]");
  });
  it("terms timestamp: same rule as the current server", () => {
    expect(buildAtomicBookingArgs(base)!._common.accepted_terms_at).toBe(base.nowIso);
    expect(buildAtomicBookingArgs({ ...base, acceptedSalonTerms: false })!._common.accepted_terms_at).toBeNull();
    expect(buildAtomicBookingArgs({ ...base, acceptedTermsAt: "2026-10-10T19:00:00.000Z" })!._common.accepted_terms_at).toBe("2026-10-10T19:00:00.000Z");
  });
  it("group notes and rebook source", () => {
    const g = buildAtomicBookingArgs({ ...base, rebook: true, rows: [...base.rows, { name: "Sam", time: "11:00", employee: null, service: base.rows[0].service }] })!;
    expect(g._lines.map((l) => l.notes)).toEqual(["Online boeking", "Groepsboeking voor Sam"]);
    expect(g._common.source_first).toBe("auto_rebook");
  });
});

describe("interpretAtomicResult: never a partial or fallback booking", () => {
  it("missing RPC / no permission / network = 503", () => {
    for (const error of [{ code: "PGRST202" }, { code: "42501" }, { code: "42883" }, new Error("offline")]) {
      expect(interpretAtomicResult({ data: null, error }, 1)).toMatchObject({ ok: false, status: 503 });
    }
  });
  it("outdated employee codes = 409 with the existing message", () => {
    for (const code of ["unknown_employee", "employee_inactive", "not_qualified"]) {
      expect(interpretAtomicResult({ data: { ok: false, code }, error: null }, 1)).toEqual({ ok: false, status: 409, body: { error: OUTDATED_MSG, code: "booking_page_outdated" } });
    }
  });
  it("slot codes = 409 slot_unavailable", () => {
    for (const code of ["conflict", "in_break", "employee_absent", "not_working", "outside_working_hours", "salon_closed", "slot_unavailable"]) {
      expect(interpretAtomicResult({ data: { ok: false, code }, error: null }, 1)).toMatchObject({ status: 409, body: { code: "slot_unavailable" } });
    }
  });
  it("booked but line count or token missing = error, not success", () => {
    expect(interpretAtomicResult({ data: { ok: true, code: "booked", appointments: [] }, error: null }, 1)).toMatchObject({ ok: false, status: 500 });
    expect(interpretAtomicResult({ data: { ok: true, code: "booked", appointments: [{ id: "x" }] }, error: null }, 1)).toMatchObject({ ok: false });
  });
  it("unknown codes fail closed", () => {
    expect(interpretAtomicResult({ data: { ok: true, code: "iets" }, error: null }, 1)).toMatchObject({ ok: false, status: 500 });
    expect(interpretAtomicResult({ data: { ok: false, code: "iets" }, error: null }, 1)).toMatchObject({ ok: false, status: 500 });
  });
});

describe("prepared server file", () => {
  const atomic = readFileSync(resolve(DIR, "public-booking.atomic.index.ts"), "utf8");
  const ref = readFileSync(resolve(DIR, "public-booking.reference.index.ts"), "utf8");
  const live = readFileSync(resolve(__dirname, "../../supabase/functions/public-booking/index.ts"), "utf8");
  it("reference copy equals the active server byte for byte", () => {
    const h = (s: string) => createHash("sha256").update(s).digest("hex");
    expect(h(ref)).toBe(h(live));
  });
  it("no direct appointment insert and no separate employee-link write", () => {
    expect(atomic).not.toMatch(/from\("appointments"\)\s*\.insert/);
    expect(atomic).not.toMatch(/appointment_employees/);
    expect(atomic).toMatch(/rpc\("create_public_booking_atomic"/);
  });
  it("only the RPC result decides employees; group payment update uses the RPC group id", () => {
    expect(atomic).toMatch(/eq\("booking_group_id", bookingGroupId\)/);
    expect(atomic).not.toMatch(/groupId\b(?<!bookingGroupId)/);
  });
  it("everything outside the save block is unchanged", () => {
    const strip = (s: string) => s.split("\n").filter((l) => !/groupId|booking_group_id|publicBookingAtomic|PREPARED|reference of|Reference/i.test(l));
    const a = strip(atomic), r = strip(ref);
    const cut = (x: string[], from: string, to: string) => [...x.slice(0, x.findIndex((l) => l.includes(from))), ...x.slice(x.findIndex((l) => l.includes(to)))];
    expect(cut(a, "ATOMIC SAVE", "if (rebookAction && appointments?.[0])")).toEqual(cut(r, "const stillAvailable", "if (rebookAction && appointments?.[0])"));
  });
});
