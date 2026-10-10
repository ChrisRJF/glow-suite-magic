# Prepared patch: secure whatsapp-send 1.0 (NOT DEPLOYED)

`index.ts` here replaces `supabase/functions/whatsapp-send/index.ts` once approved. It only wires
real Supabase, env and `fetch` into the offline modules in `supabase/functions/_shared/inactive/`:
`whatsappSendHttp.ts` (HTTP), `whatsappSendAdapters.ts` (DB/provider), `whatsappSendGuard.ts`,
`whatsappConsent.ts`, `eventVerifier.ts`, `gatewayStopAdapter.ts`, `contactRef.ts`,
`whatsappSendSigner.ts` (for callers). Tests: `src/test/whatsapp-send-http.test.ts`.

## Prerequisites (missing today -> every request answers 503, fail closed)
SQL (proposals, not applied): `2026-10-10_whatsapp_sending_paused_flag.sql`,
`2026-10-10_whatsapp_send_claims_nonces.sql`, `2026-10-09_whatsapp_gateway_receiver.sql`
(gateway_tenant_links, whatsapp_opt_outs, whatsapp_is_opted_out).
Secrets: `WA_CLAIM_HMAC_KEY`, `WA_CONTACT_REF_KEYS` (same ring as Gateway), `WA_SEND_SERVICE_KEYS`
(one key per caller). Meta (direct, per salon): `WA_META_APP_ID` (GlowSuite's Meta app),
`WA_META_TEMPLATES` (kind -> approved template name/language/category/param count),
`WA_META_CREDENTIALS` (interim: credential_ref -> token; later an encrypted vault). SQL:
`2026-10-10_whatsapp_meta_connections.sql`. No `LOVABLE_API_KEY`/`WHATSAPP_API_KEY` in this route.
No Twilio in this route.

## Transport (Meta Cloud API, direct, multi-tenant)
Each salon has its own WABA, phone number and token. `resolveMetaSender()` looks up the connection
by the VERIFIED tenant only (never request fields) and refuses: missing (503 sender_not_configured),
lookup error (503), status not active / expired (503 connection_inactive), other app
(403 connection_app_mismatch), tenant mismatch (403), capability missing (422), no token (503).
All of this happens before the claim, so a bad mapping burns no claim and calls nobody.
Templates: `GET graph.facebook.com/v25.0/{waba_id}/message_templates`; send:
`POST graph.facebook.com/v25.0/{phone_number_id}/messages`, `Authorization: Bearer <salon token>`.
WABA id, phone id and token come from the same connection row; transport re-checks the phone id.
Version pinned to v25.0: verify against Meta's Graph changelog before activation.
Only approved templates (free text refused, 24h window unproven); category, language and `{{n}}`
checked; success needs `wamid.`; 5xx/timeout/id-less 2xx = unknown, never resent; demo = no contact.

## Embedded Signup (future contract, not built)
- Identifiers: GlowSuite tenant id, WABA id, phone_number_id, Meta business id, app id.
- Exchange: owner clicks "WhatsApp verbinden" -> Meta Embedded Signup (Facebook Login for Business,
  config id) -> browser gets a short-lived `code` + waba/phone ids via session event -> sent to an
  authenticated edge function bound to the owner's tenant + one-time state -> server exchanges code
  for a business token with app secret -> token stored only in encrypted vault, row stores `credential_ref`.
- Verify before `active`: token debug (app id, granted scopes, WABA access), WABA subscribed to app,
  phone id belongs to that WABA, phone registered; ids never accepted from the browser unverified.
- Disconnect/revoke: status `revoked`, delete vault token, unsubscribe app from WABA; revoke webhook
  or failing token -> `revoked`/`expired` (sending stops). Reconnect = fresh signup, new credential_ref.
- Meta requirements (not assumed granted): Tech Provider/Solution Partner status, business
  verification, app review for `whatsapp_business_management` + `whatsapp_business_messaging`,
  Embedded Signup configuration.
- Open billing choice: salon pays Meta via own payment method on its WABA, or GlowSuite as partner
  with credit line and re-invoicing.

## Inbound (future note)
The Trial Gateway uses a Lovable-specific HMAC; that is never a Meta signature. A direct Meta
integration needs Meta webhook verification (`hub.verify_token` handshake + `X-Hub-Signature-256`
HMAC-SHA256 of the raw body with the app secret) and routing by verified `phone_number_id` ->
connection -> tenant. Gateway unchanged.

## Caller compatibility (16 routes; none changed yet)
Until a caller is updated, the new function refuses it (401/422). Nothing falls back to the old function.

| # | File | Needed change |
|---|------|---------------|
| 1 | src/pages/WachtlijstPage.tsx | send `customer_id`, `kind: waitlist_offer`, `action_id` (UUID per click, kept on retry); drop `user_id`/`to` |
| 2 | src/components/WhatsAppTemplatesCard.tsx (test) | `test: true`, pick own consenting customer, `action_id` |
| 3 | src/components/WhatsAppConnectionCard.tsx (test) | same as 2; no free phone number |
| 4 | src/components/WhatsAppCampaignEditor.tsx (test) | `kind: campaign_test`, own customer, `action_id` |
| 5 | src/components/WhatsAppCampaignEditor.tsx (send) | `kind: campaign`, one `action_id` per recipient per campaign run |
| 6 | supabase/functions/whatsapp-reminder-scheduler (24h/2h) | sign as `reminder-scheduler`, `event_ref appointment:<id>:24h|2h` |
| 7 | same, resend | same key as 6 (retry of same event) |
| 8 | same, review | `kind: review`, `event_ref appointment:<id>` |
| 9 | same, no-show | `kind: no_show`, `event_ref appointment:<id>` |
| 10 | supabase/functions/_shared/sendAppointmentReminder.ts | sign as `reminder-scheduler`, slot event_ref |
| 11 | supabase/functions/automation-scheduler | sign; send `customer_id`; `automation_run:<id>` or reminder as 6 |
| 12 | supabase/functions/auto-rebook-send | sign as `auto-rebook`, `rebook_action:<id>` |
| 13 | supabase/functions/_shared/autoRebookPass.ts | same as 12 |
| 14 | public booking confirmation | sign as `booking-confirmation`, `appointment:<id>` |
| 15 | mollie-webhook / viva-webhook | sign as `payment-webhook`, `appointment:<id>` (shares claim with 14) |
| 16 | customer-forms / dossier forms | sign as `customer-forms`, `form_request:<id>` (`:reminder` for reminders) |

Server callers: `fetch(url, { method: "POST", headers: await signServiceRequest(caller, keyId, key, raw), body: raw })`, body sent byte-for-byte as signed, no `user_id`/`to`.

## Rollout (each step separate approval)
Offline now: handler, adapters, signer, tests (done).
Staging (isolated new project, never the Gateway trial DB): apply the 3 SQL proposals, set test secrets,
deploy this patch, flag paused for all; first test: one fictitious salon, flag false, one signed
`auto-rebook` request to a mocked/sandbox-free provider stub; check 1 claim, replay 401, STOP 409.
Production:
1. Apply SQL (flag default true = all paused). 2. Set secrets. 3. Deploy this patch: old vulnerability
closed immediately; all sends paused/refused. 4. Update callers 6-16, then 1-5. 5. Release demo salon.
6. Release one real salon. Beautycare only with explicit approval from Chris.
Rollback: set flag true (pause). Never redeploy the old function.

Limitation: claims are purged after 400/430 days; the same key could then be claimed again.
