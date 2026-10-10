// Generates SQL that calls create_public_booking_atomic with arguments built by the SAME
// helper the prepared server uses (publicBookingAtomic.ts). Fictional data only.
import { buildAtomicBookingArgs } from "../../docs/prepared-patches/atomic-appointment-move/publicBookingAtomic";

const EA = "e0000000-0000-0000-0000-00000000000a", EB = "e0000000-0000-0000-0000-00000000000b";
const EX = "e0000000-0000-0000-0000-0000000000f2", SV = { id: "a0000000-0000-0000-0000-000000000060" };
const base = {
  slug: "salon-een", notes: "", depositTag: null as string | null, customerId: "c0000000-0000-0000-0000-000000000001",
  paymentRequired: false, paymentAmount: 0, paymentType: "deposit" as const, rebook: false,
  acceptedGlowsuiteTerms: true, acceptedSalonTerms: true, acceptedTermsAt: undefined, nowIso: "2026-10-10T20:00:00.000Z",
};
const q = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const call = (name: string, date: string, rows: any[], extra: Record<string, unknown> = {}) => {
  const a = buildAtomicBookingArgs({ ...base, ...extra, date, rows } as any);
  if (!a) return `SELECT 'S:${name}=refused_before_call';`;
  return `SELECT 'S:${name}='||(public.create_public_booking_atomic(${q(a._slug)},${q(a._date)},${q(JSON.stringify(a._lines))}::jsonb,${q(JSON.stringify(a._common))}::jsonb)::text);`;
};
const r = (time: string, employee: string | null, name = "Test") => ({ name, time, employee, service: SV });

console.log([
  "SET ROLE service_role;",
  call("normal", "2026-11-03", [r("10:00", EA)]),
  call("duplicate", "2026-11-03", [r("10:00", EA)]),
  call("group", "2026-11-03", [r("13:00", EA), r("13:00", EB, "Sam")]),
  call("group_partial_conflict", "2026-11-03", [r("15:00", EA), r("10:30", EA, "Sam")]),
  call("same_name_other_tino", "2026-11-03", [r("10:00", EB)]),
  call("deposit", "2026-11-04", [r("10:00", EA)], { paymentRequired: true, paymentAmount: 25, depositTag: "[deposit:new · risk=low/1]" }),
  call("too_long", "2026-11-03", [r("17:30", EA)]),
  call("break", "2026-11-05", [r("12:00", EA)]),
  call("other_salon_employee", "2026-11-05", [r("10:00", EX)]),
  call("employee_name", "2026-11-05", [r("10:00", "Tino" as any)]),
  call("no_slug", "2026-11-05", [r("10:00", EA)], { slug: null }),
  call("unknown_slug", "2026-11-05", [r("10:00", EA)], { slug: "bestaat-niet" }),
  call("cest", "2026-10-23", [r("09:00", EA)]),
  call("cet", "2026-10-27", [r("09:00", EA)]),
  call("rebook", "2026-11-06", [r("10:00", EA)], { rebook: true }),
  "RESET ROLE;",
].join("\n"));
