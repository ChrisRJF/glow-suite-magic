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

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Full-list filter for the customer page: searches EVERY loaded customer (no limit).
 * Each word of the query must appear in name or email (accent- and case-insensitive,
 * word order free: "jansen anna" finds "Anna Jansen"). Phone-like queries also match
 * Dutch phone variants (06 / +31 / 0031).
 */
export function filterCustomerList<T extends SearchableCustomer>(customers: T[], query: string): T[] {
  const q = query.trim();
  if (!q) return customers;
  const digits = q.replace(/\D/g, "");
  const isPhoneLike = digits.length >= 3 && /^[\d\s+()\-.]+$/.test(q);
  if (isPhoneLike) {
    const qPhone = phoneKey(q);
    const tail = digits.replace(/^(00)?31(0)?|^0/, "");
    return customers.filter((c) => {
      if (!c.phone) return false;
      const p = phoneKey(c.phone);
      return p.includes(qPhone) || (tail.length >= 3 && p.includes(tail));
    });
  }
  const words = fold(q).split(/\s+/).filter(Boolean);
  return customers.filter((c) => {
    const hay = fold(`${c.name ?? ""} ${c.email ?? ""} ${c.phone ?? ""}`);
    return words.every((w) => hay.includes(w));
  });
}
