// Duplicate customer detection (read-only). Only e-mail and normalised phone are
// treated as strong evidence; a matching name alone never groups customers.

export type DupCustomer = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  created_at?: string | null;
  total_spent?: number | string | null;
  notes?: string | null;
};

export type DuplicateGroup = {
  key: string;
  reasons: string[]; // e.g. "E-mail: a@b.nl", "Telefoon: 31612345678"
  customers: DupCustomer[];
  suggestedKeepId: string;
};

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e && e.includes("@") ? e : null;
}

/** Dutch-aware phone normalisation: +31 / 0031 / 06... all map to 316...; too short = ignored. */
export function normalizePhone(phone: string | null | undefined): string | null {
  let d = (phone ?? "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "31" + d.slice(1);
  d = d.replace(/\D/g, "");
  if (d.startsWith("310")) d = "31" + d.slice(3); // "+31 (0)6..."
  return d.length >= 9 ? d : null;
}

/** Search value that keeps an edited customer visible in the list. */
export function searchAfterUpdate(search: string, updated: { name: string; email?: string | null; phone?: string | null }): string {
  const q = search.toLowerCase().trim();
  if (!q) return search;
  const still = (updated.name ?? "").toLowerCase().includes(q) ||
    (updated.email ?? "").toLowerCase().includes(q) || (updated.phone ?? "").includes(q);
  return still ? search : updated.name;
}

export function findDuplicateGroups(customers: DupCustomer[]): DuplicateGroup[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  customers.forEach((c) => parent.set(c.id, c.id));

  const reasonsByKey = new Map<string, { label: string; ids: string[] }>();
  for (const c of customers) {
    const e = normalizeEmail(c.email);
    const p = normalizePhone(c.phone);
    if (e) { const k = "e:" + e; const r = reasonsByKey.get(k) ?? { label: `E-mail: ${e}`, ids: [] }; r.ids.push(c.id); reasonsByKey.set(k, r); }
    if (p) { const k = "p:" + p; const r = reasonsByKey.get(k) ?? { label: `Telefoon: +${p}`, ids: [] }; r.ids.push(c.id); reasonsByKey.set(k, r); }
  }
  for (const { ids } of reasonsByKey.values()) for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);

  const byRoot = new Map<string, DupCustomer[]>();
  for (const c of customers) { const r = find(c.id); byRoot.set(r, [...(byRoot.get(r) ?? []), c]); }

  const groups: DuplicateGroup[] = [];
  for (const [root, members] of byRoot) {
    if (members.length < 2) continue;
    const ids = new Set(members.map((m) => m.id));
    const reasons = [...reasonsByKey.values()].filter((r) => r.ids.length > 1 && ids.has(r.ids[0])).map((r) => r.label);
    const sorted = [...members].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id));
    groups.push({ key: root, reasons, customers: sorted, suggestedKeepId: sorted[0].id });
  }
  return groups.sort((a, b) => b.customers.length - a.customers.length);
}

/** Every table that references a customer. A merge must move all of them; none may be lost. */
export const CUSTOMER_LINKED_TABLES: { table: string; label: string }[] = [
  { table: "appointments", label: "Afspraken" },
  { table: "treatment_records", label: "Behandelverslagen" },
  { table: "treatment_journeys", label: "Behandeltrajecten" },
  { table: "historical_dossier_entries", label: "Historisch dossier" },
  { table: "clinical_media", label: "Foto's / media" },
  { table: "form_submissions", label: "Ingevulde formulieren" },
  { table: "form_requests", label: "Formulierverzoeken" },
  { table: "form_reissue_flags", label: "Formulier-heruitgifte" },
  { table: "customer_consents", label: "Toestemmingen" },
  { table: "payments", label: "Betalingen" },
  { table: "payment_links", label: "Betaallinks" },
  { table: "refund_requests", label: "Terugbetalingen" },
  { table: "checkout_items", label: "Kassaregels" },
  { table: "webshop_orders", label: "Webshopbestellingen" },
  { table: "gift_cards", label: "Cadeaubonnen" },
  { table: "customer_memberships", label: "Lidmaatschappen" },
  { table: "membership_usage", label: "Lidmaatschapsgebruik" },
  { table: "customer_alerts", label: "Waarschuwingen" },
  { table: "customer_tags", label: "Labels" },
  { table: "customer_message_preferences", label: "Berichtvoorkeuren" },
  { table: "feedback_entries", label: "Feedback" },
  { table: "waitlist_entries", label: "Wachtlijst" },
  { table: "rebook_actions", label: "Herboekacties" },
  { table: "auto_revenue_offers", label: "Aanbiedingen" },
  { table: "automation_logs", label: "Automatiseringslog" },
  { table: "automation_runs", label: "Automatiseringen" },
  { table: "autopilot_action_logs", label: "Autopilotlog" },
  { table: "whatsapp_logs", label: "WhatsApp-berichten" },
  { table: "whatsapp_inbound_messages", label: "WhatsApp-inkomend" },
  { table: "document_exports", label: "Documentexports" },
  { table: "document_shares", label: "Gedeelde documenten" },
  { table: "legal_holds", label: "Juridische bewaarplicht" },
  { table: "privacy_requests", label: "Privacyverzoeken" },
];
