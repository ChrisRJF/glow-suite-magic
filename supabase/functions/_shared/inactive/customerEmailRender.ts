// INACTIVE: safe link + button resolution for every send-white-label-email template.
// Replaces the inline publicBaseUrl/absoluteUrl/firstFilled logic of the active renderer.
// Not imported by any entrypoint. Activation: docs/prepared-patches/customer-email-links/.
//
// Rules: links come only from server data (stored public_slug, booking_token, stored
// google_review_url). Caller-supplied URLs in template_data are never used. A missing
// destination means the button is not rendered.
import { canonicalSlug, PUBLIC_BASE } from "./emailLinks.ts";

export const TEMPLATE_KEYS = [
  "booking_confirmation", "payment_receipt", "appointment_reminder", "booking_cancellation",
  "membership_notification", "review_request", "auto_rebook",
] as const;
export type TemplateKey = typeof TEMPLATE_KEYS[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SafeEmailLinks = {
  manageUrl?: string;
  confirmUrl?: string;
  declineUrl?: string;
  bookingUrl?: string;
  membershipUrl?: string;
  reviewUrl?: string;
  /** No real receipt page exists (/betaalbewijs is a generic placeholder). */
  receiptUrl?: undefined;
  /** Generic pages, never presented as salon-specific. */
  contactUrl?: undefined;
  termsUrl?: undefined;
  /** No .ics endpoint exists. */
  calendarUrl?: undefined;
};

export type ServerLinkInputs = {
  /** settings.public_slug of the authorized tenant. */
  publicSlug: unknown;
  /** appointments.booking_token, loaded or passed by a trusted caller; never an appointment id. */
  bookingToken?: unknown;
  /** profiles.google_review_url of the authorized tenant (server-side value only). */
  storedReviewUrl?: unknown;
};

export function safeReviewUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 500) return undefined;
  let u: URL;
  try { u = new URL(value.trim()); } catch { return undefined; }
  if (u.protocol !== "https:" || u.username || u.password) return undefined;
  return u.toString();
}

export function buildSafeEmailLinks(i: ServerLinkInputs): SafeEmailLinks {
  const slug = canonicalSlug(i.publicSlug);
  const token = typeof i.bookingToken === "string" && UUID.test(i.bookingToken) ? i.bookingToken.toLowerCase() : null;
  return {
    manageUrl: token ? `${PUBLIC_BASE}/mijn-afspraak/${token}` : undefined,
    confirmUrl: token ? `${PUBLIC_BASE}/afspraak/${token}/bevestigen` : undefined,
    declineUrl: token ? `${PUBLIC_BASE}/afspraak/${token}/annuleren` : undefined,
    bookingUrl: slug ? `${PUBLIC_BASE}/boeken/${slug}` : undefined,
    membershipUrl: slug ? `${PUBLIC_BASE}/abonnementen/${slug}` : undefined,
    reviewUrl: safeReviewUrl(i.storedReviewUrl),
    receiptUrl: undefined,
    contactUrl: undefined,
    termsUrl: undefined,
    calendarUrl: undefined,
  };
}

export type ActionSlot = "manage" | "booking" | "membership" | "review";
export type TemplateActions = {
  primary?: { slot: ActionSlot; url: string };
  secondary?: { slot: ActionSlot; url: string };
  confirmFlow?: { confirmUrl: string; declineUrl: string };
  showCalendar: false;
  showTerms: false;
  showRoute: false;
};

/** Which buttons each template may show. Unavailable destinations are dropped, never replaced by a fallback path. */
export function templateActions(key: TemplateKey, l: SafeEmailLinks): TemplateActions {
  const pick = (slot: ActionSlot) => {
    const url = { manage: l.manageUrl, booking: l.bookingUrl, membership: l.membershipUrl, review: l.reviewUrl }[slot];
    return url ? { slot, url } : undefined;
  };
  const order: Record<TemplateKey, ActionSlot[]> = {
    booking_confirmation: ["manage"],
    payment_receipt: ["manage"],
    appointment_reminder: ["manage"],
    booking_cancellation: ["booking"],
    membership_notification: ["membership", "booking"],
    review_request: ["review", "booking"],
    auto_rebook: ["booking"],
  };
  const slots = order[key].map(pick).filter(Boolean) as { slot: ActionSlot; url: string }[];
  const confirmFlow = key === "appointment_reminder" && l.confirmUrl && l.declineUrl
    ? { confirmUrl: l.confirmUrl, declineUrl: l.declineUrl } : undefined;
  return { primary: slots[0], secondary: slots[1], confirmFlow, showCalendar: false, showTerms: false, showRoute: false };
}

/** Plain-text variant must contain only the same validated links. */
export function allowedLinksIn(a: TemplateActions): string[] {
  return [a.primary?.url, a.secondary?.url, a.confirmFlow?.confirmUrl, a.confirmFlow?.declineUrl].filter(Boolean) as string[];
}

/**
 * Safe stop: CUSTOMER_EMAIL_PAUSED. Sending is allowed only on the explicit value "false".
 * "true", missing, empty or any other value blocks (fail-closed). Read per request, never cached.
 */
export function customerEmailPaused(envValue: string | undefined): boolean {
  return (envValue ?? "").trim().toLowerCase() !== "false";
}
