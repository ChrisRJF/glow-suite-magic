// Display-only helpers for staff in the agenda. Identity is always the employee ID; never the name.

export interface StaffLike { id: string; name: string; color?: string | null; role?: string | null }

// Distinct, readable on light and dark backgrounds.
export const STAFF_PALETTE = ["#7B61FF", "#E0457B", "#0E9F8E", "#E07B12", "#2F7DE1", "#9B51C9", "#4A8F2A", "#C2410C"];

const norm = (s: string) => s.trim().toLowerCase();

/** Unique label per employee ID. Same names get a role or a number, e.g. "Tino (2)". */
export function staffLabels(staff: StaffLike[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of staff) {
    const same = staff.filter((o) => norm(o.name) === norm(e.name));
    if (same.length < 2) { out.set(e.id, e.name); continue; }
    const roles = new Set(same.map((o) => norm(o.role || "")));
    out.set(e.id, roles.size === same.length && e.role ? `${e.name} (${e.role})` : `${e.name} (${same.indexOf(e) + 1})`);
  }
  return out;
}

/** One distinct color per employee ID; keeps the salon's own color unless another employee already uses it. */
export function staffColors(staff: StaffLike[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const e of staff) {
    const own = (e.color || "").toUpperCase();
    if (own && !used.has(own)) { out.set(e.id, e.color as string); used.add(own); continue; }
    const pick = STAFF_PALETTE.find((c) => !used.has(c.toUpperCase())) || STAFF_PALETTE[out.size % STAFF_PALETTE.length];
    out.set(e.id, pick); used.add(pick.toUpperCase());
  }
  return out;
}

/** Name written in old notes ("Medewerker: Roos"). Text only, never an assignment. */
export function noteStaffName(notes?: string | null): string | null {
  const m = notes?.match(/Medewerker: ([^|\n]+)/)?.[1]?.trim();
  return m && m !== "Niet toegewezen" ? m : null;
}

export const NO_STAFF_MESSAGE = "Kies een medewerker voor deze afspraak.";
