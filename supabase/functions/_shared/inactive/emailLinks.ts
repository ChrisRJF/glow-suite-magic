// INACTIVE: prepared link builder for customer emails (booking confirmation,
// reminder, cancellation, rebook). Not imported by any entrypoint.
// Activation requires separate approval (see docs/prepared-patches/customer-email-links/README.md).
//
// Rules:
// - Only the main domain is used. Salon subdomains (*.glowsuite.nl) are not served.
// - The salon is identified only by its stored public_slug (same lookup as public-booking).
//   Never derived from salon_name, never from a caller-supplied slug.
// - Appointment links require the random booking_token (uuid), never the appointment id.
// - No calendar (.ics) link until an approved endpoint exists: calendarUrl is always undefined.

export const PUBLIC_BASE = "https://glowsuite.nl";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Routes that exist in src/App.tsx and are reachable without login. */
const ALLOWED_PATHS: RegExp[] = [
  /^\/boeken\/[a-z0-9-]+$/,
  /^\/mijn-afspraak\/[0-9a-f-]{36}$/i,
  /^\/afspraak\/[0-9a-f-]{36}(?:\/(?:bevestigen|annuleren))?$/i,
  /^\/abonnementen\/[a-z0-9-]+$/,
  /^\/route-contact$/,
  /^\/salonvoorwaarden$/,
];

export type CustomerEmailLinks = {
  bookingUrl?: string;
  manageUrl?: string;
  /** Generic pages are never presented as salon-specific route or terms. */
  contactUrl?: undefined;
  termsUrl?: undefined;
  calendarUrl?: undefined;
};

export function canonicalSlug(publicSlug: unknown): string | null {
  const s = typeof publicSlug === "string" ? publicSlug.trim() : "";
  return s.length > 0 && s.length <= 120 && SLUG.test(s) ? s : null;
}

export function buildCustomerEmailLinks(args: { publicSlug: unknown; bookingToken?: unknown }): CustomerEmailLinks {
  const slug = canonicalSlug(args.publicSlug);
  const token = typeof args.bookingToken === "string" && UUID.test(args.bookingToken) ? args.bookingToken.toLowerCase() : null;
  return {
    bookingUrl: slug ? `${PUBLIC_BASE}/boeken/${slug}` : undefined,
    manageUrl: token ? `${PUBLIC_BASE}/mijn-afspraak/${token}` : undefined,
    contactUrl: undefined,
    termsUrl: undefined,
    calendarUrl: undefined,
  };
}

/** Accept a caller-supplied link only if it points to an existing public route on the main domain. */
export function isAllowedCustomerUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let u: URL;
  try { u = new URL(value); } catch { return false; }
  if (u.protocol !== "https:" || u.host !== "glowsuite.nl" || u.username || u.password) return false;
  return ALLOWED_PATHS.some((re) => re.test(u.pathname));
}

/** Rebook links must stay on the salon's own booking page. */
export function isSalonBookingUrl(value: unknown, publicSlug: unknown): value is string {
  const slug = canonicalSlug(publicSlug);
  if (!slug || !isAllowedCustomerUrl(value)) return false;
  return new URL(value).pathname === `/boeken/${slug}`;
}
