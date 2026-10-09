# Addendum to Gateway dispatch contract v1 (PROPOSED, NOT ACTIVE)

Applies to `docs/glowsuite-dispatch-contract.md` in the Gateway project. The
Gateway side is not built; this must be agreed and implemented there too.

## 1. `opt_out_signal.data.contact_ref`

Compared options:

| | Keyed hash of phone (chosen) | GlowSuite-issued reference |
|---|---|---|
| Works with data that exists today | Yes: Gateway has the inbound number, GlowSuite has the destination number at send time | No: Gateway would need a stored ref per outbound message; no GlowSuite to Gateway send path exists yet |
| STOP from a number GlowSuite never messaged via Gateway | Still blocks future sends to that number | Cannot be matched |
| Phone stored by GlowSuite for STOP | No, only the ref | No |
| Brute-force risk | Phones are low-entropy, so a plain hash is unsafe. Mitigated by a secret key (HMAC) and per-tenant key derivation | None |
| Cross-tenant | Per-tenant derived key: same number gives different refs per tenant | Per-tenant by construction |

Definition:

```text
normalised = strict E.164 with "+" (rules in contactRef.ts normalizeE164; ambiguous -> no ref)
tenant_key = HMAC-SHA256(CONTACT_REF_KEY[v], "glowsuite-contact-ref:v1:" + tenant_id)
contact_ref = "c1." + v + "." + hex(HMAC-SHA256(tenant_key, normalised))
```

- `CONTACT_REF_KEY` is a separate secret from the request signing key, held by
  both sides, versioned by `v`.
- GlowSuite stores the opt-out per `(salon_id, contact_ref)`, never the number.
- STOP is recorded even when no customer matches; it blocks the number, not a
  customer record. No customer lookup, no customer data change.
- At send time GlowSuite computes the ref under every active key version and
  refuses the send if any is opted out. Numbers that cannot be normalised
  unambiguously are refused (fail closed).
- Rotation: new STOPs use the newest version. Old versions stay in verify-only
  mode for as long as opt-outs with that version exist, because unknown numbers
  cannot be re-derived. Retiring a version requires a separate migration plan.
- Retention: opt-outs are kept until the customer explicitly opts in again.
  Receipts (no number, no ref text in response) are kept at least 400 days.
- Logs contain neither number nor ref.

## 2. `delivery_status_record`

- `outbound_ref` must exist in `whatsapp_outbound_messages` for the resolved
  salon; otherwise `422 business_rejected` (`unknown_outbound_ref`).
- Status order: sent < delivered < read. `failed` never overrides delivered or
  read; it is counted in `failed_attempts`.

## 3. `confirmation_token_received`

Answered `422 business_rejected` (`confirmation_not_enabled`) before any write
until real token validation is built and approved.
