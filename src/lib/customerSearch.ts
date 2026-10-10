import { normalizePhone } from "@/lib/customerDuplicates";

export interface SearchableCustomer { id: string; name?: string | null; email?: string | null; phone?: string | null }

/** Digits-only phone key; Dutch variants (06 / +31 / 0031 / +31 (0)6) map to the same key. */
function phoneKey(v: string): string {
  return normalizePhone(v) ?? v.replace(/\D/g, "");
}

/**
 * Find customers by name, email or phone. Returns at most `limit` matches so the UI never
 * renders thousands of options. Name matches that start with the query come first.
 */
export function searchCustomers<T extends SearchableCustomer>(customers: T[], query: string, limit = 50): T[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const digits = q.replace(/\D/g, "");
  const isPhoneLike = digits.length >= 3 && /^[\d\s+()\-.]+$/.test(q);
  const qPhone = isPhoneLike ? phoneKey(q) : "";
  // "0612" -> also match stored "+31612..." by comparing without the leading 0 / 31
  const qPhoneTail = isPhoneLike ? digits.replace(/^(00)?31(0)?|^0/, "") : "";
  const starts: T[] = [];
  const other: T[] = [];
  for (const c of customers) {
    const name = (c.name ?? "").toLowerCase();
    let hit = name.includes(q) || (c.email ?? "").toLowerCase().includes(q);
    if (!hit && isPhoneLike && c.phone) {
      const p = phoneKey(c.phone);
      hit = p.includes(qPhone) || (qPhoneTail.length >= 3 && p.includes(qPhoneTail));
    }
    if (!hit) continue;
    (name.startsWith(q) ? starts : other).push(c);
    if (starts.length >= limit) break;
  }
  return [...starts, ...other].slice(0, limit);
}
