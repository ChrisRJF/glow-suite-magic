# INACTIVE modules (not imported by any deployed function)

Nothing in this folder is imported by a function entrypoint, so it is never
bundled or deployed. Wiring any of it into `whatsapp-send`, the schedulers or a
new receiver requires separate approval because edge function edits deploy
automatically.

- `whatsappSendAuth.ts`  – caller authorization for `whatsapp-send`
- `whatsappConsent.ts`   – fail-closed WhatsApp consent / STOP evaluation
- `gatewayReceiver.ts`   – HMAC-v1 receiver for the GlowSuite WhatsApp Gateway
  (flag `GLOWSUITE_WHATSAPP_GATEWAY_ENABLED`, default off)

Proposed schema: `docs/proposed-migrations/` (NOT applied).
