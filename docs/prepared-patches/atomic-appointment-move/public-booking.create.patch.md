# Prepared change for supabase/functions/public-booking/index.ts (NOT applied)

Replaces, in `create_booking`, the second `assertAvailability` call + `appointments.insert` +
separate `appointment_employees.insert` with ONE call to `create_public_booking_atomic`
(lock + re-check + insert of all lines + links in one transaction, same lock key as agenda moves).

Unchanged: slug/salon load, zod validation, first `assertAvailability` (chooses automatic
employees; hidden staff stay anonymous to the client), customer create/lookup, deposit decision,
rebook token validation, payment start (Mollie/Viva), emails. Booking tokens are created by the
database column default and returned by the RPC, so payment redirects and "Afspraak beheren" keep working.

```ts
// after the first assertAvailability() resolved bookingRows[i].employee (UUID or null)
const { data: rpc, error: rpcError } = await supabase.rpc("create_public_booking_atomic", {
  _slug: ctx.settings.public_slug,           // tenant is resolved from the slug INSIDE the RPC
  _date: data.date,
  _lines: bookingRows.map((row, index) => ({
    time: row.time,
    service_id: row.service.id,
    employee_id: row.employee,               // verified UUID or null, never a name
    notes: [data.notes, index > 0 ? `Groepsboeking voor ${row.name}` : "Online boeking",
            decision.required ? `[deposit:${decision.reason} · risk=${decision.risk_level}/${decision.risk_score}]` : null]
            .filter(Boolean).join(" · "),
  })),
  _common: {
    customer_id: customerId,
    status: serverPayment.required ? "pending_confirmation" : "confirmed",
    payment_status: serverPayment.required ? "pending" : "unpaid",
    payment_required: serverPayment.required,
    deposit_amount: serverPayment.required ? serverPayment.amount : 0,
    payment_type: serverPayment.type,
    source_first: rebookAction ? "auto_rebook" : "online_booking",
    accepted_glowsuite_terms: Boolean(data.customer.accepted_glowsuite_terms),
    accepted_salon_terms: Boolean(data.customer.accepted_salon_terms),
    accepted_terms_at: data.customer.accepted_terms_at ?? null,
  },
});
if (rpcError) {
  // RPC missing or failing: never fall back to the old non-atomic insert
  console.error("create_public_booking_atomic failed", rpcError.code);
  return json({ error: "Online boeken is even niet beschikbaar. Probeer het later opnieuw." }, 503);
}
if (!rpc?.ok) {
  if (rpc?.code === "unknown_employee") return json({ error: OUTDATED_MSG, code: "booking_page_outdated" }, 409);
  return json({ error: "Deze tijd is net volgeboekt. Kies een nieuw moment.", code: "slot_unavailable" }, 409);
}
const appointments = rpc.appointments;      // id, booking_token, appointment_date, start_time, end_time, employee_id, service_id, payment_status, status, price
// booking_reference: read once after commit (set by the existing trigger), e.g.
// supabase.from("appointments").select("id, booking_reference").in("id", appointments.map(a => a.id))
// rebook_actions update + payments: unchanged code below, using `appointments`.
```

Notes
- Price comes from the service row inside the RPC (not from the request).
- `appointment_employees` links are inserted in the same transaction. Today a failed link is only
  logged; with the RPC the booking is rolled back instead (test B10).
- Rebook attribution (`rebook_actions` update) and payment rows stay after the commit, as today.
  A crash between commit and payment start leaves the booking with `payment_status = pending`,
  same behaviour as today.
- EXECUTE is granted to `service_role` only. anon and logged-in users cannot call it (test B03).
