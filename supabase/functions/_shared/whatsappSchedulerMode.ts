// Pure constants for the WhatsApp scheduler (no network imports; unit-testable).
export const OPAQUE_BEARER = /^Bearer ([A-Za-z0-9]{32,512})$/;
// Fixed fail-safe: the scheduled sweep never dispatches while this is false.
// Changing it requires a code change and a separate owner GO.
export const SCHEDULED_DISPATCH_ENABLED = false;
