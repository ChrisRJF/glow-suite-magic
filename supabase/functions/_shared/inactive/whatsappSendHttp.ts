// INACTIVE (Send Security 1.0). Complete HTTP request handling for the future whatsapp-send.
// Not imported by any active entrypoint. The deployable wrapper is docs/prepared-patches/whatsapp-send/index.ts.
//
// Routing of identity (never from the body):
//   x-wa-caller header present -> internal service request: HMAC v2 over the exact raw body
//                                 (handleServiceSend). Authorization header is ignored for identity.
//   otherwise                  -> user request: Bearer JWT verified server-side (auth.getUser).
//                                 A service-role key is not a user and yields 401.

import { guardedSend, handleServiceSend, identityFromVerifiedJwt, SEND_PATH, type Result, type SendRequest } from "./whatsappSendGuard.ts";
import type { BuiltDeps } from "./whatsappSendAdapters.ts";

export const MAX_BODY_BYTES = 16 * 1024;
const ACCEPTED_PATHS = new Set(["/whatsapp-send", SEND_PATH]);

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** User-facing texts. Never raw provider or database errors. */
const MESSAGES: Record<string, string> = {
  unauthenticated: "Je bent niet ingelogd.",
  sending_paused: "WhatsApp-verzending staat tijdelijk uit.",
  whatsapp_disabled: "WhatsApp is niet ingeschakeld voor deze salon.",
  role_not_allowed: "Je hebt geen rechten om dit bericht te versturen.",
  customer_stopped: "Deze klant heeft zich afgemeld voor WhatsApp.",
  consent_unknown: "Deze klant heeft geen WhatsApp-toestemming gegeven.",
  marketing_consent_missing: "Deze klant heeft geen toestemming voor dit soort berichten.",
  duplicate: "Dit bericht is al verstuurd.",
  outcome_unknown: "Onbekend of dit bericht is aangekomen. Het wordt niet automatisch opnieuw verstuurd.",
  provider_rejected: "Het bericht kon niet worden verstuurd.",
};
const fallback = (status: number) => status >= 500 ? "Verzenden is nu niet mogelijk." : "Bericht niet verzonden.";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function fromResult(r: Result) {
  if (r.ok) return json(200, { success: true, status: r.result, ...(r.sid ? { sid: r.sid } : {}), ...(r.result === "simulated" ? { demo: true, simulated: true } : {}) });
  return json(r.status, { success: false, error: r.reason, message: MESSAGES[r.reason] ?? fallback(r.status) });
}

export interface HttpEnv {
  /** Built per request; null = configuration missing -> 503 before any read. */
  build(): BuiltDeps | null;
  /** auth.getUser(token) -> sub. Throws/null = not authenticated. */
  verifyJwt(token: string): Promise<{ sub: string } | null>;
}

export async function handleWhatsAppSendHttp(req: Request, env: HttpEnv): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "method_not_allowed" });
  let path: string;
  try { path = new URL(req.url).pathname; } catch { return json(404, { success: false, error: "not_found" }); }
  if (!ACCEPTED_PATHS.has(path)) return json(404, { success: false, error: "not_found" });

  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) return json(413, { success: false, error: "body_too_large" });
  let raw: string;
  try { raw = await req.text(); } catch { return json(400, { success: false, error: "invalid_body" }); }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { success: false, error: "body_too_large" });

  let built: BuiltDeps | null;
  try { built = env.build(); } catch { built = null; }
  if (!built) return fromResult({ ok: false, status: 503, reason: "not_configured" });

  let result: Result;
  try {
    const caller = req.headers.get("x-wa-caller");
    if (caller !== null) {
      result = await handleServiceSend({
        method: "POST", path: SEND_PATH, rawBody: raw,
        headers: { caller, keyId: req.headers.get("x-wa-key-id"), ts: req.headers.get("x-wa-timestamp"),
          nonce: req.headers.get("x-wa-nonce"), sig: req.headers.get("x-wa-signature") },
      }, built.service, built.deps);
    } else {
      const identity = await identityFromVerifiedJwt(req.headers.get("authorization"), env.verifyJwt);
      let body: unknown;
      try { body = JSON.parse(raw); } catch { return fromResult({ ok: false, status: 400, reason: "invalid_json" }); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return fromResult({ ok: false, status: 400, reason: "invalid_json" });
      result = await guardedSend(identity, body as SendRequest, built.deps);
    }
  } catch {
    // Any unexpected adapter failure before transport: refuse. (Transport/finalize errors are handled in the guard.)
    result = { ok: false, status: 503, reason: "dependency_failed" };
  }
  console.log("wa-send-http", { status: result.status, reason: result.ok ? result.result : result.reason });
  return fromResult(result);
}
