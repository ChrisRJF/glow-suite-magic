// E-mail delivery for the EXISTING customer-forms intake link.
// Reuses: form_requests row + 256-bit token from customer-forms, the /formulier/<token>
// page, the customer_email_controls stop switch and the Resend sender used by
// send-white-label-email. The mail carries ONLY a link; answers and raw tokens are
// never logged. Scope: server-side tenant + recipient allow-lists, default deny.
export function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
export function validEmail(value: unknown): string | undefined {
  const email = String(value || "").trim().toLowerCase();
  return email.length <= 255 && EMAIL.test(email) ? email : undefined;
}

export const SENDER_DOMAIN = "email.glowsuite.nl";
const RESERVED = new Set(["admin", "administrator", "abuse", "billing", "bookings", "contact", "hello", "help", "info", "mail", "noreply", "postmaster", "security", "support"]);

export function senderLocalPart(publicSlug: unknown, salonName: string, tenantId: string): string {
  const slugify = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 48);
  const stable = typeof publicSlug === "string" && publicSlug.trim() ? slugify(publicSlug) : "";
  const b = stable || slugify(salonName) || "salon";
  const safe = RESERVED.has(b) ? `salon${b}` : b;
  return stable ? safe.slice(0, 60) : `${safe.slice(0, 48)}${tenantId.replace(/-/g, "").slice(0, 8)}`.slice(0, 60);
}

/** Only an existing row with sending_enabled === true allows sending. */
export async function sendingAllowed(read: () => Promise<{ sending_enabled: unknown } | null>): Promise<boolean> {
  try { const row = await read(); return row?.sending_enabled === true; } catch { return false; }
}

/** Initial scope: only the fictitious Studio Nova DEMO tenant. Changing this needs approval. */
export const FORM_EMAIL_TENANTS = new Set(["5dbfcbd4-48ff-4010-a1cc-07ed737880ce", "1c6c885e-c944-4717-b2ef-9cfdb9fa15ae"]);
/** Tenants that may mail their OWN customers' dossier address (no recipient test list). Approved: Beautycare. */
export const FORM_EMAIL_OPEN_TENANTS = new Set(["1c6c885e-c944-4717-b2ef-9cfdb9fa15ae"]);
function recipientAllowed(tenantId: string, to: string, recipients: Set<string>) {
  return FORM_EMAIL_OPEN_TENANTS.has(tenantId) || recipients.has(to);
}

export function parseList(raw: string | undefined | null): Set<string> {
  return new Set(String(raw ?? "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
}

export function emailScopeAllowed(tenantId: string, email: unknown, tenants: Set<string>, recipients: Set<string>): boolean {
  const to = validEmail(email);
  return tenants.has(tenantId) && !!to && recipientAllowed(tenantId, to.toLowerCase(), recipients);
}

export type FormMailRequest = { id: string; user_id: string; customer_id: string; status: string; expires_at: string };
export type FormMailCustomer = { id: string; name: string | null; email: string | null; archived_at: string | null; pseudonymized_at: string | null; communication_blocked_at: string | null };

export type FormMailDeps = {
  readStopSwitch: () => Promise<{ sending_enabled: unknown } | null>;
  allowedTenants: Set<string>;
  allowedRecipients: Set<string>;
  loadRequest: (tenantId: string, requestId: string) => Promise<FormMailRequest | null>;
  loadCustomer: (tenantId: string, customerId: string) => Promise<FormMailCustomer | null>;
  loadSalon: (tenantId: string) => Promise<{ salon_name?: string | null; public_slug?: string | null } | null>;
  /** Fresh token for a resend. Not stored until the provider confirms the send. */
  newToken: () => Promise<{ token: string; hash: string }>;
  /** Store the new hash on the same open request; returns false if nothing was updated. */
  commitToken: (tenantId: string, requestId: string, hash: string) => Promise<boolean>;
  /** true when a SENT log with this idempotency key exists for the tenant. */
  alreadySent: (tenantId: string, key: string) => Promise<boolean>;
  sendEmail: (msg: { from: string; to: string; subject: string; html: string; text: string; idempotencyKey: string }) => Promise<{ ok: boolean; id?: string | null }>;
  /** Metadata only: never answers, never the token. */
  log: (row: { tenant_id: string; form_request_id: string; status: string; reason?: string; idempotency_key?: string; to?: string; from?: string; subject?: string; provider_id?: string | null }) => Promise<void>;
  now?: () => number;
  origin?: string;
};

export type FormMailInput = { tenantId: string; requestId: string; formTitle: string; token?: string | null; resendKey?: string | null };
export type FormMailResult = { ok: true; sent: boolean; duplicate?: boolean } | { ok: false; reason: string };

export function buildFormMail(salonName: string, customerName: string | null, formTitle: string, link: string) {
  const first = String(customerName || "").trim().split(/\s+/)[0] || "";
  const hi = first ? `Hoi ${first},` : "Hoi,";
  const subject = `${salonName}: vul je intakeformulier in`;
  const text = `${hi}\n\n${salonName} vraagt je het formulier "${formTitle}" in te vullen voor je afspraak.\n\nOpen het beveiligde formulier: ${link}\n\nDeze link is persoonlijk. Deel hem niet.`;
  const html = `<p>${escapeHtml(hi)}</p><p>${escapeHtml(salonName)} vraagt je het formulier "${escapeHtml(formTitle)}" in te vullen voor je afspraak.</p><p><a href="${escapeHtml(link)}">Formulier openen</a></p><p style="color:#8A8F98;font-size:12px">Deze link is persoonlijk. Deel hem niet.</p>`;
  return { subject, text, html };
}

const TOKEN_RE = /^[a-f0-9]{64}$/;
const KEY_RE = /^[A-Za-z0-9-]{8,64}$/;

export async function deliverFormRequestEmail(deps: FormMailDeps, input: FormMailInput): Promise<FormMailResult> {
  const { tenantId, requestId } = input;
  const resend = input.resendKey !== undefined && input.resendKey !== null;
  const fail = async (reason: string): Promise<FormMailResult> => {
    await deps.log({ tenant_id: tenantId, form_request_id: requestId, status: "blocked", reason }).catch(() => {});
    return { ok: false, reason };
  };
  if (resend && !KEY_RE.test(String(input.resendKey))) return fail("invalid_resend_key");
  if (!(await sendingAllowed(deps.readStopSwitch))) return fail("email_stopped");
  if (!deps.allowedTenants.has(tenantId)) return fail("tenant_not_allowed");

  const req = await deps.loadRequest(tenantId, requestId).catch(() => null);
  if (!req || req.user_id !== tenantId) return fail("request_not_found");
  if (!["sent", "opened"].includes(req.status)) return fail("request_not_open");
  if (Date.parse(req.expires_at) <= (deps.now?.() ?? Date.now())) return fail("request_expired");

  const c = await deps.loadCustomer(tenantId, req.customer_id).catch(() => null);
  if (!c || c.id !== req.customer_id) return fail("customer_not_found");
  if (c.archived_at || c.pseudonymized_at || c.communication_blocked_at) return fail("customer_communication_blocked");
  const to = validEmail(c.email)?.toLowerCase();
  if (!to) return fail("customer_email_missing");
  if (!recipientAllowed(tenantId, to, deps.allowedRecipients)) return fail("recipient_not_allowed");

  const idempotencyKey = `form_request:${requestId}:${resend ? `resend:${input.resendKey}` : "initial"}`;
  let seen: boolean;
  try { seen = await deps.alreadySent(tenantId, idempotencyKey); } catch { return fail("idempotency_unreadable"); }
  if (seen) return { ok: true, sent: false, duplicate: true };

  let token: string | null = null;
  let pendingHash: string | null = null;
  if (resend) {
    try { const t = await deps.newToken(); token = t.token; pendingHash = t.hash; } catch { token = null; }
  } else {
    token = input.token ?? null;
  }
  if (!token || !TOKEN_RE.test(token)) return fail("token_unavailable");

  const salon = await deps.loadSalon(tenantId).catch(() => null);
  const salonName = salon?.salon_name?.trim() || "Je salon";
  const link = `${deps.origin || "https://glowsuite.nl"}/formulier/${token}`;
  const mail = buildFormMail(salonName, c.name, input.formTitle, link);
  const from = `${salonName} <${senderLocalPart(salon?.public_slug, salonName, tenantId)}@${SENDER_DOMAIN}>`;
  const meta = { tenant_id: tenantId, form_request_id: requestId, idempotency_key: idempotencyKey, to, from, subject: mail.subject };

  let res: { ok: boolean; id?: string | null };
  try {
    res = await deps.sendEmail({ from, to, ...mail, idempotencyKey });
  } catch {
    // Unclear outcome: keep the existing link valid, never mark as sent.
    await deps.log({ ...meta, status: "unclear" }).catch(() => {});
    return { ok: false, reason: "provider_unclear" };
  }
  if (!res.ok) {
    await deps.log({ ...meta, status: "failed" }).catch(() => {});
    return { ok: false, reason: "provider_failed" };
  }
  if (pendingHash) {
    const stored = await deps.commitToken(tenantId, requestId, pendingHash).catch(() => false);
    if (!stored) {
      await deps.log({ ...meta, status: "failed", reason: "token_commit_failed", provider_id: res.id ?? null }).catch(() => {});
      return { ok: false, reason: "token_commit_failed" };
    }
  }
  await deps.log({ ...meta, status: "sent", provider_id: res.id ?? null }).catch(() => {});
  return { ok: true, sent: true };
}
