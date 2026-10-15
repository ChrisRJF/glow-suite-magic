// PREPARED, INACTIVE. Replacement rule for getSalon() in supabase/functions/public-booking/index.ts
// plus the BookingPage URL handoff. Not imported anywhere active (editing the live server deploys it
// immediately; separate GO needed). See ACTIVATION-legacy-name.md.
//
// Rule:
// 1. Stored public_slug match (exact or slugified) always wins. Valid slug URLs never change.
// 2. Legacy name link (no stored slug matches): resolve ONLY when exactly one non-demo salon has that
//    derived name AND a stored public_slug. The answer carries canonical_slug so the page can switch URL.
// 3. Zero or several name matches, demo rows, rows without a stored slug, or an incomplete row list:
//    not found (fail closed). Replaces today's "first of 200 unordered rows".
// Links built from a FORMER salon name cannot be resolved: no name history is stored. Preserving them
// would need a persistent alias table (separate migration + GO). Never guessed here.

export type SalonRow = { user_id: string; salon_name: string | null; public_slug: string | null; is_demo?: boolean | null };
export type Resolved<T extends SalonRow> = { row: T; via: "slug" | "legacy_name"; canonicalSlug: string } | null;

/** Max rows the server loads for the legacy-name scan. A full page means the list may be incomplete. */
export const LEGACY_SCAN_LIMIT = 1000;

export function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function resolvePublicSalon<T extends SalonRow>(requested: string, rows: T[]): Resolved<T> {
  const raw = String(requested ?? "").trim();
  const wanted = slugify(raw);
  if (!wanted) return null;
  const bySlug = rows.filter((r) => r.public_slug && (r.public_slug === raw || r.public_slug === wanted));
  if (bySlug.length === 1) return { row: bySlug[0], via: "slug", canonicalSlug: bySlug[0].public_slug! };
  if (bySlug.length > 1) return null; // unique index should prevent this; never guess
  if (rows.length >= LEGACY_SCAN_LIMIT) return null; // list may be truncated: a unique match is not provable
  const byName = rows.filter((r) => !r.is_demo && r.public_slug && slugify(r.salon_name || "") === wanted);
  return byName.length === 1 ? { row: byName[0], via: "legacy_name", canonicalSlug: byName[0].public_slug! } : null;
}

/**
 * Frontend handoff. After get_salon, if the server's canonical slug differs from the URL segment,
 * returns the path to replace the URL with (query string such as ?rb= or booking token kept),
 * so every later call (get_availability, get_booking, create_booking) uses the canonical slug.
 * Returns null when no switch is needed or the canonical value is unusable.
 */
export function canonicalBookingPath(pathname: string, search: string, urlSlug: string, canonical: string | null | undefined): string | null {
  if (!canonical || canonical === urlSlug || !/^[a-z0-9-]+$/.test(canonical)) return null;
  const parts = pathname.split("/");
  const idx = parts.findIndex((p) => { try { return decodeURIComponent(p) === urlSlug; } catch { return false; } });
  if (idx < 0) return null;
  parts[idx] = canonical;
  return parts.join("/") + (search || "");
}
