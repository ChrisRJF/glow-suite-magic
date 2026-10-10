// Customer import dedupe rules (shared by preview and import so both count the same).
// Exact = same normalised e-mail AND phone. One contact only = skip only if that record also has
// the same name and no different filled contact. Anything doubtful = conflict (manual review, not imported).
import { normalizeEmail, normalizePhone } from "@/lib/customerDuplicates";

export type ImportDecision =
  | { kind: "new" }
  | { kind: "dupe"; id: string }
  | { kind: "conflict"; reason: string };

type Rec = { id: string; name: string; email: string | null; phone: string | null };

const normName = (n: string | null | undefined) => (n ?? "").toLowerCase().trim().replace(/\s+/g, " ");

export class CustomerImportIndex {
  private byEmail = new Map<string, Rec[]>();
  private byPhone = new Map<string, Rec[]>();
  private byName = new Map<string, Rec[]>();

  constructor(existing: { id: string; name?: string | null; email?: string | null; phone?: string | null }[] = []) {
    existing.forEach((c) => this.add(c.id, c.name ?? "", c.email ?? null, c.phone ?? null));
  }

  add(id: string, name: string, email: string | null, phone: string | null) {
    const r: Rec = { id, name: normName(name), email: normalizeEmail(email), phone: normalizePhone(phone) };
    const push = (m: Map<string, Rec[]>, k: string | null) => { if (k) m.set(k, [...(m.get(k) ?? []), r]); };
    push(this.byEmail, r.email); push(this.byPhone, r.phone); push(this.byName, r.name || null);
  }

  decide(name: string, email: string | null, phone: string | null): ImportDecision {
    const e = normalizeEmail(email), p = normalizePhone(phone), n = normName(name);
    const me = e ? this.byEmail.get(e) ?? [] : [];
    const mp = p ? this.byPhone.get(p) ?? [] : [];
    if (e && p) {
      const exact = me.find((r) => r.phone === p);
      if (exact) return { kind: "dupe", id: exact.id };
      if (me.length || mp.length) return { kind: "conflict", reason: me.length ? "Zelfde e-mail, ander telefoonnummer" : "Zelfde telefoonnummer, ander e-mailadres" };
      return { kind: "new" };
    }
    const m = e ? me : p ? mp : [];
    if (e || p) {
      if (!m.length) return { kind: "new" };
      const same = m.find((r) => r.name === n);
      if (same) return { kind: "dupe", id: same.id };
      return { kind: "conflict", reason: e ? "Zelfde e-mail, andere naam" : "Zelfde telefoonnummer, andere naam" };
    }
    // No contact data: a name alone never proves a duplicate.
    if (n && this.byName.has(n)) return { kind: "conflict", reason: "Alleen naam komt overeen, geen contactgegevens" };
    return { kind: "new" };
  }
}
