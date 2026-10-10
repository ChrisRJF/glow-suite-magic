// INACTIVE: complete secured send-white-label-email handler (pure, dependency-injected).
// Wired by docs/prepared-patches/customer-email-links/send-white-label-email.index.ts.
// Order per request: method -> body -> DB stop switch (sends only, fresh read, fail-closed)
// -> authorization (emailSendAuth) -> server-side salon data -> safe links -> render -> send.
import { authorizeEmailRequest, type EmailAuthDeps } from "./emailSendAuth.ts";
import { buildSafeEmailLinks, TEMPLATE_KEYS, type TemplateKey } from "./customerEmailRender.ts";
import { renderTemplate, validEmail } from "./customerEmailTemplates.ts";
import { normalizeEmailLang, type EmailLang } from "../emailTranslations.ts";

export const SENDER_DOMAIN = "email.glowsuite.nl";
const RESERVED = new Set(["admin", "administrator", "abuse", "billing", "bookings", "contact", "hello", "help", "info", "mail", "noreply", "postmaster", "security", "support"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGS = new Set(["nl", "en", "de", "fr", "es"]);
export const MAX_BODY_BYTES = 32 * 1024;

export type SalonSettings = { salon_name?: string | null; public_slug?: string | null; whitelabel_branding?: any; demo_mode?: boolean | null; is_demo?: boolean | null; language?: string | null; google_review_url?: string | null };

export type HandlerDeps = EmailAuthDeps & {
  /** Fresh read of public.customer_email_controls on every call. Must throw or return error on DB failure. */
  readStopSwitch: () => Promise<{ sending_enabled: unknown } | null>;
  loadSettings: (tenantId: string) => Promise<SalonSettings | null>;
  ownerEmail: (tenantId: string) => Promise<string | null>;
  customerLanguage: (tenantId: string, email: string) => Promise<string | null>;
  /** appointments.booking_token where id = appointmentId AND user_id = tenant. */
  tokenForAppointment: (tenantId: string, appointmentId: string) => Promise<string | null>;
  /** true if an appointment with this booking_token exists for the tenant. */
  tokenBelongsToTenant: (tenantId: string, token: string) => Promise<boolean>;
  log: (row: Record<string, unknown>) => Promise<void>;
  sendEmail: (msg: { from: string; to: string; subject: string; html: string; text: string; replyTo?: string; idempotencyKey: string }) => Promise<{ ok: boolean; id?: string | null }>;
};

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/** Only an existing row with sending_enabled === true allows sending. Missing row, other values or errors block. */
export async function sendingAllowed(read: HandlerDeps["readStopSwitch"]): Promise<boolean> {
  try { const row = await read(); return row?.sending_enabled === true; } catch { return false; }
}

export function senderLocalPart(publicSlug: unknown, salonName: string, tenantId: string): string {
  const slugify = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 48);
  const stable = typeof publicSlug === "string" && publicSlug.trim() ? slugify(publicSlug) : "";
  const b = stable || slugify(salonName) || "salon";
  const safe = RESERVED.has(b) ? `salon${b}` : b;
  return stable ? safe.slice(0, 60) : `${safe.slice(0, 48)}${tenantId.replace(/-/g, "").slice(0, 8)}`.slice(0, 60);
}

type Body = { user_id: string; salon_name?: string; recipient_email: string; recipient_name: string; template_key: TemplateKey; template_data: Record<string, unknown>; idempotency_key: string; preview_only: boolean; language?: EmailLang };

function parseBody(raw: unknown): Body | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  const str = (v: unknown, min: number, max: number) => typeof v === "string" && v.trim().length >= min && v.trim().length <= max ? v.trim() : null;
  const user_id = typeof b.user_id === "string" && UUID.test(b.user_id) ? b.user_id : null;
  const recipient = validEmail(b.recipient_email);
  const key = TEMPLATE_KEYS.includes(b.template_key as TemplateKey) ? (b.template_key as TemplateKey) : null;
  const idem = str(b.idempotency_key, 8, 180);
  const td = b.template_data === undefined ? {} : b.template_data;
  if (!user_id || !recipient || !key || !idem || !td || typeof td !== "object" || Array.isArray(td)) return null;
  if (b.preview_only !== undefined && typeof b.preview_only !== "boolean") return null;
  if (b.language !== undefined && !LANGS.has(b.language as string)) return null;
  return {
    user_id, recipient_email: recipient, template_key: key, idempotency_key: idem,
    salon_name: str(b.salon_name, 1, 120) ?? undefined,
    recipient_name: str(b.recipient_name, 0, 120) ?? "",
    template_data: td as Record<string, unknown>,
    preview_only: b.preview_only === true,
    language: b.language as EmailLang | undefined,
  };
}

export function createCustomerEmailHandler(deps: HandlerDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "Methode niet toegestaan" }, 405);
    let raw: unknown;
    try {
      const text = await req.text();
      if (text.length > MAX_BODY_BYTES) return json({ error: "Ongeldige invoer" }, 413);
      raw = JSON.parse(text);
    } catch { return json({ error: "Ongeldige invoer" }, 400); }
    const body = parseBody(raw);
    if (!body) return json({ error: "Ongeldige invoer" }, 400);

    // 1. Global stop switch, fresh DB read, only for real sends. Fail-closed.
    if (!body.preview_only && !(await sendingAllowed(deps.readStopSwitch))) return json({ error: "email_paused" }, 503);

    // 2. Authorization: identity, tenant and role from server data; body.user_id never trusted alone.
    const access = body.preview_only ? { mode: "preview" as const } : { mode: "send" as const, recipientEmail: body.recipient_email };
    const auth = await authorizeEmailRequest(req.headers.get("Authorization"), body.user_id, deps, access);
    if (auth.ok !== true) { const f = auth as { status: number; error: string }; return json({ error: f.error }, f.status); }
    const tenantId = auth.tenantId;

    try {
      const settings = await deps.loadSettings(tenantId);
      if (!settings) return json({ error: "Salon niet gevonden" }, 404);
      const branding = settings.whitelabel_branding || {};
      const salonName = settings.salon_name || branding.salon_name || body.salon_name || "Salon";

      // 3. booking_token only from the tenant's own appointment; never an appointment id.
      const td = body.template_data;
      let token: string | null = null;
      if (typeof td.appointment_id === "string" && UUID.test(td.appointment_id)) token = await deps.tokenForAppointment(tenantId, td.appointment_id);
      else if (typeof td.booking_token === "string" && UUID.test(td.booking_token) && (await deps.tokenBelongsToTenant(tenantId, td.booking_token))) token = td.booking_token;
      const links = buildSafeEmailLinks({ publicSlug: settings.public_slug, bookingToken: token, storedReviewUrl: settings.google_review_url });

      const lang: EmailLang = body.language
        ?? normalizeEmailLang((await deps.customerLanguage(tenantId, body.recipient_email).catch(() => null)) || settings.language || "nl");
      const rendered = renderTemplate(body.template_key, { ...td, recipient_name: body.recipient_name }, salonName, branding, lang, links);
      const local = senderLocalPart(settings.public_slug, salonName, tenantId);
      const fromEmail = `${local}@${SENDER_DOMAIN}`;
      const replyTo = validEmail(branding.contact_email) || validEmail(await deps.ownerEmail(tenantId).catch(() => null));
      const isDemo = Boolean(settings.is_demo || settings.demo_mode);
      const common = {
        user_id: tenantId, salon_slug: local, from_email: fromEmail, from_name: salonName,
        recipient_email: body.recipient_email, template_key: body.template_key, subject: rendered.subject, provider: "resend",
        metadata: { idempotency_key: body.idempotency_key, preview: rendered.preview, reply_to: replyTo || null, language: lang, caller: auth.caller },
        is_demo: isDemo,
      };

      if (body.preview_only || isDemo) {
        await deps.log({ ...common, status: body.preview_only ? "preview" : "demo_skipped" });
        return json({ success: true, preview_only: true, from: `${salonName} <${fromEmail}>`, reply_to: replyTo || null, subject: rendered.subject, preview: rendered.preview, html: rendered.html, text: rendered.text, links: rendered.links, language: lang });
      }

      const res = await deps.sendEmail({ from: `${salonName} <${fromEmail}>`, to: body.recipient_email, subject: rendered.subject, html: rendered.html, text: rendered.text, replyTo, idempotencyKey: body.idempotency_key });
      if (!res.ok) {
        await deps.log({ ...common, status: "failed", error_message: "provider_error" });
        return json({ error: "Email kon niet worden verzonden" }, 502);
      }
      await deps.log({ ...common, status: "sent", provider_message_id: res.id ?? null });
      return json({ success: true, from: `${salonName} <${fromEmail}>`, reply_to: replyTo || null, subject: rendered.subject, provider_message_id: res.id ?? null, language: lang });
    } catch {
      return json({ error: "Email kon niet worden verwerkt" }, 500);
    }
  };
}
