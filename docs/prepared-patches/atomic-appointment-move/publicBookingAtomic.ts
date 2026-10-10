// PREPARED, INACTIVE. Copied next to public-booking/index.ts only at activation (step 2b).
// Pure helpers for the atomic online booking: request building and result mapping.
// No I/O here, so the same code is used by the prepared server and by the offline tests.

export const OUTDATED_MSG = "Deze boekingspagina is verouderd. Vernieuw de pagina en kies opnieuw een medewerker en tijd.";
export const UNAVAILABLE_MSG = "Online boeken is even niet beschikbaar. Probeer het later opnieuw.";
export const SLOT_TAKEN_MSG = "Deze tijd is net volgeboekt. Kies een nieuw moment.";
export const SAVE_FAILED_MSG = "Er ging iets mis bij het opslaan van je boeking. Probeer het opnieuw.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AtomicRow = { name: string; time: string; employee: string | null; service: { id: string } };
export type AtomicInput = {
  slug: string | null | undefined;          // ctx.settings.public_slug (stored value, never the URL text)
  date: string;
  rows: AtomicRow[];                        // employee = server-verified UUID or null
  notes: string;
  depositTag: string | null;                // "[deposit:... · risk=...]" or null
  customerId: string;
  paymentRequired: boolean;
  paymentAmount: number;
  paymentType: "deposit" | "full";
  rebook: boolean;
  acceptedGlowsuiteTerms: boolean;
  acceptedSalonTerms: boolean;
  acceptedTermsAt: string | null | undefined;
  nowIso: string;
};

export type AtomicArgs = { _slug: string; _date: string; _lines: Array<Record<string, unknown>>; _common: Record<string, unknown> };

/** Builds the exact RPC arguments. Returns null when the request may not be sent (fail closed). */
export function buildAtomicBookingArgs(i: AtomicInput): AtomicArgs | null {
  if (!i.slug || typeof i.slug !== "string") return null;   // salon only found by name: no reliable slug
  if (!i.rows.length || i.rows.some((r) => r.employee !== null && !UUID.test(r.employee))) return null;
  return {
    _slug: i.slug,
    _date: i.date,
    _lines: i.rows.map((row, index) => ({
      time: row.time,
      service_id: row.service.id,
      employee_id: row.employee,
      notes: [i.notes, index > 0 ? `Groepsboeking voor ${row.name}` : "Online boeking", i.depositTag]
        .filter(Boolean).join(" · "),
    })),
    _common: {
      customer_id: i.customerId,
      status: i.paymentRequired ? "pending_confirmation" : "confirmed",
      payment_status: i.paymentRequired ? "pending" : "unpaid",
      payment_required: i.paymentRequired,
      deposit_amount: i.paymentRequired ? i.paymentAmount : 0,
      payment_type: i.paymentType,
      source_first: i.rebook ? "auto_rebook" : "online_booking",
      accepted_glowsuite_terms: i.acceptedGlowsuiteTerms,
      accepted_salon_terms: i.acceptedSalonTerms,
      // same rule as the current server: explicit value, else "now" when both were accepted
      accepted_terms_at: i.acceptedTermsAt ?? ((i.acceptedGlowsuiteTerms && i.acceptedSalonTerms) ? i.nowIso : null),
    },
  };
}

export type AtomicAppointment = {
  id: string; booking_token: string; appointment_date: string; start_time: string; end_time: string;
  employee_id: string | null; service_id: string; payment_status: string; status: string; price: number;
};
export type AtomicOutcome =
  | { ok: true; appointments: AtomicAppointment[]; bookingGroupId: string | null }
  | { ok: false; status: number; body: { error: string; code?: string } };

const OUTDATED_CODES = new Set(["unknown_employee", "employee_inactive", "not_qualified"]);
const SLOT_CODES = new Set([
  "conflict", "slot_unavailable", "outside_hours", "outside_working_hours", "salon_closed",
  "not_working", "employee_absent", "in_break", "invalid_local_time",
]);

/** Maps the RPC answer. Any transport/permission error = 503, never a fallback write. */
export function interpretAtomicResult(res: { data: unknown; error: unknown }, expectedLines: number): AtomicOutcome {
  if (res.error) return { ok: false, status: 503, body: { error: UNAVAILABLE_MSG, code: "booking_unavailable" } };
  const d = res.data as any;
  if (!d || typeof d !== "object") return { ok: false, status: 503, body: { error: UNAVAILABLE_MSG, code: "booking_unavailable" } };
  if (d.ok === true && d.code === "booked") {
    const appts = Array.isArray(d.appointments) ? d.appointments : [];
    if (appts.length !== expectedLines || appts.some((a: any) => !a?.id || !a?.booking_token)) {
      return { ok: false, status: 500, body: { error: SAVE_FAILED_MSG } };
    }
    return { ok: true, appointments: appts, bookingGroupId: d.booking_group_id ?? null };
  }
  if (d.ok === false && OUTDATED_CODES.has(d.code)) return { ok: false, status: 409, body: { error: OUTDATED_MSG, code: "booking_page_outdated" } };
  if (d.ok === false && SLOT_CODES.has(d.code)) return { ok: false, status: 409, body: { error: SLOT_TAKEN_MSG, code: "slot_unavailable" } };
  if (d.ok === false && d.code === "not_found") return { ok: false, status: 503, body: { error: UNAVAILABLE_MSG, code: "booking_unavailable" } };
  return { ok: false, status: 500, body: { error: SAVE_FAILED_MSG } };
}
