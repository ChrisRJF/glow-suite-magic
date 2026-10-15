// PREPARED, INACTIVE. Replacement rule for getSalon() in supabase/functions/public-booking/index.ts.
// Not imported anywhere active (editing the live server deploys it immediately; separate GO needed).
//
// Rule:
// 1. Stored public_slug match (exact or slugified) always wins. Valid slug URLs never change.
// 2. Legacy name link (no stored slug matches): resolve ONLY when exactly one non-demo salon has that
//    derived name AND a stored public_slug. The answer carries canonical_slug so the page can switch URL.
// 3. Zero or several name matches, demo rows, or rows without a stored slug: not found (fail closed).
//    Replaces today's "first of 200 unordered rows" which is not deterministic for duplicate names.

export type SalonRow = { user_id: string; salon_name: string | null; public_slug: string | null; is_demo?: boolean | null };
export type Resolved<T extends SalonRow> = { row: T; via: "slug" | "legacy_name"; canonicalSlug: string } | null;

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
  const byName = rows.filter((r) => !r.is_demo && r.public_slug && slugify(r.salon_name || "") === wanted);
  return byName.length === 1 ? { row: byName[0], via: "legacy_name", canonicalSlug: byName[0].public_slug! } : null;
}
