// INACTIVE prepared template diff for supabase/functions/send-white-label-email/index.ts
// (booking_confirmation branch, currently lines ~175-207). NOT imported anywhere active.
//
// PROBLEM in the ACTIVE renderer: when no manage_url is given, it still builds
//   absoluteUrl("", "/afspraak/beheer", https://<slug>.glowsuite.nl)
// and always renders a "manage" button with that non-working subdomain link.
//
// REQUIRED BEFORE ACTIVATION (separate approval, separate deploy of send-white-label-email):
//   1. In the booking_confirmation branch replace
//        primaryAction: { label: t.cta_manage, url: manageUrl }
//      with
//        primaryAction: bookingConfirmationManageAction(data, t.cta_manage)
//   2. Copy this function into the renderer (or _shared) unchanged.
//   Other templates (payment_receipt, reminders) are out of scope and keep their behavior.
//
// shell() already omits the button when primaryAction.url is empty, so returning undefined
// yields an e-mail with NO manage button and NO /afspraak/beheer URL in the HTML.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
export const MANAGE_BASE = "https://glowsuite.nl/mijn-afspraak/";

/** Fail-closed: only the exact main-domain Mijn afspraak URL with a valid UUID token passes. */
export function safeManageUrl(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v.startsWith(MANAGE_BASE)) return null;
  const token = v.slice(MANAGE_BASE.length);
  return UUID.test(token) ? `${MANAGE_BASE}${token.toLowerCase()}` : null;
}

export function bookingConfirmationManageAction(data: Record<string, unknown>, label: string): { label: string; url: string } | undefined {
  const url = safeManageUrl(data.manage_url);
  return url ? { label, url } : undefined;
}

/** Exact copy of the CURRENT active behavior, kept only so tests can prove the gap. */
export function currentActiveManageUrl(data: Record<string, unknown>, publicBaseUrl: string): string {
  const raw = [data.manage_url, data.appointment_url].map((x) => String(x ?? "").trim()).find(Boolean) || "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw && raw !== "#" ? raw : "/afspraak/beheer";
  return `${publicBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Minimal copy of the active shell() CTA rule: a button is rendered only when url is filled. */
export function renderPrimaryCta(action?: { label: string; url: string }): string {
  return action?.url ? `<a href="${action.url}" data-cta="manage">${action.label}</a>` : "";
}
