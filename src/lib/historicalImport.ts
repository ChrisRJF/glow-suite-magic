/** Pure helpers for the (demo-only) historical dossier import. No network, no AI. */

export type HistoricalKind = "appointment" | "treatment_note";

export const HISTORICAL_FIELDS: Record<HistoricalKind, { key: string; label: string; required?: boolean; aliases: string[] }[]> = {
  appointment: [
    { key: "customer_name", label: "Klantnaam", aliases: ["klant", "klantnaam", "naam", "customer", "name", "client"] },
    { key: "customer_email", label: "E-mail klant", aliases: ["email", "e-mail", "klant e-mail", "customer email"] },
    { key: "customer_phone", label: "Telefoon klant", aliases: ["telefoon", "phone", "mobiel", "mobile", "telefoonnummer"] },
    { key: "date", label: "Datum", required: true, aliases: ["datum", "date", "afspraakdatum", "start date", "dag"] },
    { key: "time", label: "Tijd", aliases: ["tijd", "starttijd", "time", "start", "begintijd"] },
    { key: "service_name", label: "Behandeling", aliases: ["behandeling", "dienst", "service", "treatment"] },
    { key: "employee_name", label: "Medewerker", aliases: ["medewerker", "employee", "staff", "behandelaar"] },
    { key: "price", label: "Prijs", aliases: ["prijs", "price", "bedrag", "amount"] },
    { key: "status", label: "Status", aliases: ["status", "state"] },
  ],
  treatment_note: [
    { key: "customer_name", label: "Klantnaam", aliases: ["klant", "klantnaam", "naam", "customer", "name", "client"] },
    { key: "customer_email", label: "E-mail klant", aliases: ["email", "e-mail", "klant e-mail", "customer email"] },
    { key: "customer_phone", label: "Telefoon klant", aliases: ["telefoon", "phone", "mobiel", "mobile", "telefoonnummer"] },
    { key: "date", label: "Datum", required: true, aliases: ["datum", "date", "behandeldatum", "created at", "aangemaakt"] },
    { key: "service_name", label: "Behandeling", aliases: ["behandeling", "dienst", "service", "treatment"] },
    { key: "employee_name", label: "Medewerker", aliases: ["medewerker", "employee", "staff", "behandelaar", "auteur", "author"] },
    { key: "note", label: "Verslag / notitie", required: true, aliases: ["verslag", "notitie", "notities", "note", "notes", "behandelverslag", "opmerking", "inhoud", "tekst"] },
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();

export function autoMap(kind: HistoricalKind, headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<string>();
  for (const f of HISTORICAL_FIELDS[kind]) {
    const h = headers.find((x) => !used.has(x) && f.aliases.some((a) => norm(x) === norm(a)));
    if (h) { map[f.key] = h; used.add(h); }
  }
  return map;
}

export function normPhone(raw?: string): string | null {
  if (!raw) return null;
  let p = String(raw).replace(/[^\d+]/g, "");
  if (!p) return null;
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (p.startsWith("0")) p = "+31" + p.slice(1);
  if (!p.startsWith("+")) p = "+" + p;
  return p.length >= 9 ? p : null;
}

export function parseDate(raw?: string): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y: string, mo: string, d: string;
  if (m) [y, mo, d] = [m[1], m[2], m[3]];
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) [y, mo, d] = [m[3], m[2], m[1]];
  else return null;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const dt = new Date(iso + "T00:00:00Z");
  return !isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso ? iso : null;
}

export function parseTime(raw?: string): string | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d{1,2})[:.](\d{2})/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

export interface CustomerLite { id: string; name: string; email: string | null; phone: string | null }

export type MatchResult =
  | { status: "matched"; customerId: string; via: "email" | "phone" }
  | { status: "check"; candidates: string[]; reason: string }
  | { status: "none"; reason: string };

/**
 * Only an unambiguous e-mail or phone match links automatically.
 * Name-only matches and conflicts always require manual review.
 */
export function matchCustomer(row: { name?: string; email?: string; phone?: string }, customers: CustomerLite[]): MatchResult {
  const email = row.email?.trim().toLowerCase() || "";
  const phone = normPhone(row.phone);
  const name = row.name?.trim().toLowerCase() || "";
  const byEmail = email ? customers.filter((c) => (c.email || "").toLowerCase() === email) : [];
  const byPhone = phone ? customers.filter((c) => normPhone(c.phone || "") === phone) : [];
  const byName = name ? customers.filter((c) => c.name.trim().toLowerCase() === name) : [];

  if (byEmail.length === 1 && (!phone || byPhone.length === 0 || byPhone[0].id === byEmail[0].id))
    return { status: "matched", customerId: byEmail[0].id, via: "email" };
  if (byEmail.length === 0 && byPhone.length === 1) return { status: "matched", customerId: byPhone[0].id, via: "phone" };
  const cands = Array.from(new Set([...byEmail, ...byPhone, ...byName].map((c) => c.id)));
  if (cands.length > 0) {
    const reason = byEmail.length > 1 || byPhone.length > 1 ? "Meerdere klanten gevonden" : byEmail.length === 1 && byPhone.length >= 1 ? "E-mail en telefoon wijzen naar verschillende klanten" : "Alleen naam komt overeen";
    return { status: "check", candidates: cands, reason };
  }
  return { status: "none", reason: !name && !email && !phone ? "Geen klantgegevens" : "Geen klant gevonden" };
}

/** Stable fingerprint so re-importing the same file never creates duplicates. */
export function fingerprintSource(kind: HistoricalKind, customerId: string, v: { date: string; time?: string | null; service?: string; note?: string }): string {
  return [kind, customerId, v.date, v.time || "", (v.service || "").trim().toLowerCase(), (v.note || "").trim().replace(/\s+/g, " ")].join("|");
}

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
