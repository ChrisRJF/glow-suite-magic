// INACTIVE proposal: From local part for send-white-label-email that does not
// change when settings.public_slug is filled or edited. Not imported by any entrypoint.
const RESERVED = new Set(["admin", "administrator", "abuse", "billing", "bookings", "contact", "hello", "help", "info", "mail", "noreply", "postmaster", "security", "support"]);

export function slugify(value: string) {
  const slug = value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 48);
  return slug || "salon";
}

export type SenderArgs = {
  requested?: string;
  publicSlug?: string | null;
  salonName: string;
  userId: string;
  /** Set by callers that today send no salon_slug (reminder scheduler, rebook): keep name + 8 id chars. */
  legacyNameId?: boolean;
};

export function senderLocalPart(a: SenderArgs) {
  const stored = a.publicSlug ? slugify(a.publicSlug) : null;
  let base: string;
  let stable: boolean;
  if (a.legacyNameId || !a.requested) {
    base = slugify(a.salonName); stable = false;
  } else if (stored && slugify(a.requested) === stored) {
    // Caller forwarded the stored public_slug; before the fill it sent slugify(salon_name).
    base = slugify(a.salonName); stable = true;
  } else {
    base = slugify(a.requested); stable = true;
  }
  const safe = RESERVED.has(base) ? `salon${base}` : base;
  if (stable) return safe.slice(0, 60);
  return `${safe.slice(0, 48)}${a.userId.replace(/-/g, "").slice(0, 8)}`.slice(0, 60);
}
