// INACTIVE: e-mail delivery for the EXISTING customer-forms intake link.
// Not imported by any entrypoint. Wiring it into customer-forms (channel === "email")
// needs separate approval because edge function edits deploy automatically.
//
// Reuses: form_requests row + 256-bit token (generateFormToken/hashToken) created by
// customer-forms, the /formulier/<token> page, the customer_email_controls stop switch
// (sendingAllowed) and the existing sender (senderLocalPart + SENDER_DOMAIN).
// Rules: the mail carries ONLY a link. Answers, form contents and the raw token are
// never put in logs; the server resolves tenant, customer and request.
import { sendingAllowed, senderLocalPart, SENDER_DOMAIN } from "./customerEmailHandler.ts";
import { escapeHtml, validEmail } from "./customerEmailTemplates.ts";

export type FormMailRequest = { id: string; user_id: string; customer_id: string; status: string; expires_at: string; is_demo: boolean };
export type FormMailCustomer = { id: string; name: string | null; email: string | null; archived_at: string | null; pseudonymized_at: string | null; communication_blocked_at: string | null };

export type FormMailDeps = {
  readStopSwitch: () => Promise<{ sending_enabled: unknown } | null>;
  /** Server-side recipient allow-list (test scope). Empty set = nobody. */
  allowedRecipients: Set<string>;
  /** Server-side tenant allow-list. Empty set = nobody. */
  allowedTenants: Set<string>;
  loadRequest: (tenantId: string, requestId: string) => Promise<FormMailRequest | null>;
  loadCustomer: (tenantId: string, customerId: string) => Promise<FormMailCustomer | null>;
  loadSalon: (tenantId: string) => Promise<{ salon_name?: string | null; public_slug?: string | null } | null>;
  /** Resend: store a fresh token hash on the same request (old link stops working). */
  rotateToken: (tenantId: string, requestId: string) => Promise<string | null>;
  sendEmail: (msg: { from: string; to: string; subject: string; html: string; text: string; idempotencyKey: string }) => Promise<{ ok: boolean; id?: string | null }>;
  /** Metadata only. */
  log: (row: { tenant_id: string; form_request_id: string; status: string; reason?: string; provider_id?: string | null }) => Promise<void>;
  now?: () => number;
  origin?: string;
};

export type FormMailInput = { tenantId: string; requestId: string; formTitle: string; token?: string | null; resend?: boolean; attempt?: number };
export type FormMailResult = { ok: true; sent: boolean; reason?: string } | { ok: false; reason: string };

export function buildFormMail(salonName: string, customerName: string | null, formTitle: string, link: string) {
  const first = String(customerName || "").trim().split(/\s+/)[0] || "";
  const hi = first ? `Hoi ${first},` : "Hoi,";
  const subject = `${salonName}: vul je intakeformulier in`;
  const text = `${hi}\n\n${salonName} vraagt je het formulier "${formTitle}" in te vullen voor je afspraak.\n\nOpen het beveiligde formulier: ${link}\n\nDeze link is persoonlijk. Deel hem niet.`;
  const html = `<p>${escapeHtml(hi)}</p><p>${escapeHtml(salonName)} vraagt je het formulier "${escapeHtml(formTitle)}" in te vullen voor je afspraak.</p><p><a href="${escapeHtml(link)}">Formulier openen</a></p><p style="color:#8A8F98;font-size:12px">Deze link is persoonlijk. Deel hem niet.</p>`;
  return { subject, text, html };
}

export async function deliverFormRequestEmail(deps: FormMailDeps, input: FormMailInput): Promise<FormMailResult> {
  const { tenantId, requestId } = input;
  const fail = async (reason: string): Promise<FormMailResult> => {
    await deps.log({ tenant_id: tenantId, form_request_id: requestId, status: "blocked", reason }).catch(() => {});
    return { ok: false, reason };
  };
  if (!(await sendingAllowed(deps.readStopSwitch))) return fail("email_stopped");
  if (!deps.allowedTenants.has(tenantId)) return fail("tenant_not_allowed");

  const req = await deps.loadRequest(tenantId, requestId).catch(() => null);
  if (!req || req.user_id !== tenantId) return fail("request_not_found");
  if (!["sent", "opened"].includes(req.status)) return fail("request_not_open");
  if (Date.parse(req.expires_at) <= (deps.now?.() ?? Date.now())) return fail("request_expired");

  const c = await deps.loadCustomer(tenantId, req.customer_id).catch(() => null);
  if (!c || c.id !== req.customer_id) return fail("customer_not_found");
  if (c.archived_at || c.pseudonymized_at || c.communication_blocked_at) return fail("customer_communication_blocked");
  const to = validEmail(c.email);
  if (!to) return fail("customer_email_missing");
  if (!deps.allowedRecipients.has(to.toLowerCase())) return fail("recipient_not_allowed");

  let token = input.resend ? null : input.token ?? null;
  if (!token) token = await deps.rotateToken(tenantId, requestId).catch(() => null);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return fail("token_unavailable");

  const salon = await deps.loadSalon(tenantId).catch(() => null);
  const salonName = salon?.salon_name?.trim() || "Je salon";
  const link = `${deps.origin || "https://glowsuite.nl"}/formulier/${token}`;
  const mail = buildFormMail(salonName, c.name, input.formTitle, link);
  const attempt = Math.max(0, Math.floor(input.attempt ?? 0));
  const idempotencyKey = `form_request:${requestId}:${input.resend ? `resend-${attempt}` : "initial"}`;

  let res: { ok: boolean; id?: string | null };
  try {
    res = await deps.sendEmail({ from: `${salonName} <${senderLocalPart(salon?.public_slug, salonName, tenantId)}@${SENDER_DOMAIN}>`, to, ...mail, idempotencyKey });
  } catch {
    await deps.log({ tenant_id: tenantId, form_request_id: requestId, status: "unclear" }).catch(() => {});
    return { ok: false, reason: "provider_unclear" };
  }
  await deps.log({ tenant_id: tenantId, form_request_id: requestId, status: res.ok ? "sent" : "failed", provider_id: res.id ?? null }).catch(() => {});
  return res.ok ? { ok: true, sent: true } : { ok: false, reason: "provider_failed" };
}
