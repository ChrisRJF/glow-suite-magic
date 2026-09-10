// Klantdossier P2a — document content assembly.
//
// Every document is built from the IMMUTABLE snapshot that was stored at the
// moment of signing/completion. The live template is never consulted, so a v1
// contract keeps rendering exactly as v1 even when v3 is active.

import { canonicalJson } from "../_shared/formCanonical.ts";
import { type Block, displayValue, nlDate, nlDateTime } from "../_shared/pdfDoc.ts";

export interface SubmissionRow {
  id: string;
  rendered_snapshot: Record<string, unknown> | null;
  document_hash: string;
  signer_name: string | null;
  signed_at: string | null;
  submitted_at: string;
  appointment_id: string | null;
  audit_metadata: Record<string, unknown> | null;
}

export interface RecordRow {
  id: string;
  template_snapshot: Record<string, unknown> | null;
  values: Record<string, unknown> | null;
  template_version: number | null;
  status: string;
  completed_at: string | null;
  appointment_id: string | null;
  service_name?: string | null;
  employee_name?: string | null;
}

export async function verifySubmissionHash(row: SubmissionRow): Promise<boolean> {
  if (!row.rendered_snapshot || !row.document_hash) return false;
  const bytes = new TextEncoder().encode(canonicalJson(row.rendered_snapshot));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === row.document_hash;
}

function snapshotFields(snapshot: Record<string, unknown> | null): Array<{ label: string; value: unknown }> {
  const fields = (snapshot?.fields as Array<Record<string, unknown>> | undefined) ?? [];
  return fields.map((f) => ({ label: String(f.label ?? f.key ?? ""), value: f.value }));
}

export function formBlocks(
  row: SubmissionRow,
  customerName: string,
  appointmentLabel: string | null,
): Block[] {
  const snap = row.rendered_snapshot ?? {};
  const kind = String(snap.kind ?? "formulier");
  const blocks: Block[] = [
    { t: "title", text: String(snap.title ?? "Formulier") },
    { t: "subtitle", text: kind === "consent" ? "Toestemmingsformulier" : kind === "contract" ? "Contract" : "Intakeformulier" },
    { t: "rule" },
    { t: "kv", label: "Klant", value: customerName },
    { t: "kv", label: "Versie", value: `versie ${displayValue(snap.version)}` },
    { t: "kv", label: "Ingevuld op", value: nlDateTime(row.submitted_at) },
  ];
  if (appointmentLabel) blocks.push({ t: "kv", label: "Afspraak", value: appointmentLabel });
  blocks.push({ t: "heading", text: "Vragen en antwoorden" });
  for (const f of snapshotFields(snap)) {
    blocks.push({ t: "kv", label: f.label, value: displayValue(f.value) });
  }

  if (snap.require_signature) {
    blocks.push({ t: "heading", text: "Ondertekening" });
    blocks.push({ t: "kv", label: "Naam ondertekenaar", value: displayValue(row.signer_name) });
    blocks.push({ t: "kv", label: "Ondertekend op", value: nlDateTime(row.signed_at) });
    blocks.push({
      t: "kv",
      label: "Wijze",
      value: snap.signature_method === "drawn" ? "Getekende handtekening" : "Digitaal akkoord met naam",
    });
    blocks.push({ t: "kv", label: "Status", value: row.signed_at ? "Digitaal ondertekend" : "Niet ondertekend" });
    blocks.push({ t: "space", size: 4 });
    blocks.push({
      t: "text",
      text: "De ondertekenaar heeft bevestigd bovenstaande informatie te hebben gelezen en akkoord te gaan.",
    });
  }

  blocks.push({ t: "rule" });
  blocks.push({ t: "muted", text: `Documentkenmerk: ${row.document_hash.slice(0, 16)}` });
  return blocks;
}

export function treatmentBlocks(
  row: RecordRow,
  customerName: string,
  appointmentLabel: string | null,
  photoNote: string | null,
): Block[] {
  const snap = row.template_snapshot ?? {};
  const fields = (snap.fields as Array<Record<string, unknown>> | undefined) ?? [];
  const values = row.values ?? {};
  const blocks: Block[] = [
    { t: "title", text: String(snap.title ?? "Behandelverslag") },
    { t: "subtitle", text: "Behandelverslag" },
    { t: "rule" },
    { t: "kv", label: "Klant", value: customerName },
    { t: "kv", label: "Behandeling", value: displayValue(row.service_name) },
    { t: "kv", label: "Behandelaar", value: displayValue(row.employee_name) },
    { t: "kv", label: "Afgerond op", value: nlDateTime(row.completed_at) },
    { t: "kv", label: "Status", value: row.status === "completed" ? "Afgerond" : "Concept" },
    { t: "kv", label: "Versie", value: `versie ${displayValue(row.template_version)}` },
  ];
  if (appointmentLabel) blocks.push({ t: "kv", label: "Afspraak", value: appointmentLabel });

  blocks.push({ t: "heading", text: "Verslag" });
  if (fields.length === 0) {
    blocks.push({ t: "muted", text: "Geen velden vastgelegd." });
  }
  for (const f of fields) {
    const key = String(f.key ?? "");
    blocks.push({ t: "kv", label: String(f.label ?? key), value: displayValue((values as Record<string, unknown>)[key]) });
  }

  if (photoNote) {
    blocks.push({ t: "heading", text: "Foto's" });
    blocks.push({ t: "muted", text: photoNote });
  }
  return blocks;
}

export function customerHeaderBlocks(
  customer: { name: string; email: string | null; phone: string | null; created_at: string },
  sections: Record<string, boolean>,
): Block[] {
  const blocks: Block[] = [
    { t: "title", text: "Klantdossier" },
    { t: "subtitle", text: customer.name },
    { t: "rule" },
  ];
  if (sections.customer) {
    blocks.push({ t: "heading", text: "Klantgegevens" });
    blocks.push({ t: "kv", label: "Naam", value: customer.name });
    blocks.push({ t: "kv", label: "E-mail", value: displayValue(customer.email) });
    blocks.push({ t: "kv", label: "Telefoon", value: displayValue(customer.phone) });
    blocks.push({ t: "kv", label: "Klant sinds", value: nlDate(customer.created_at) });
  }
  return blocks;
}

export function alertBlocks(alerts: Array<{ label: string; created_at: string; review_status: string }>): Block[] {
  const blocks: Block[] = [{ t: "heading", text: "Aandachtspunten" }];
  if (alerts.length === 0) {
    blocks.push({ t: "muted", text: "Geen aandachtspunten." });
    return blocks;
  }
  for (const a of alerts) {
    blocks.push({ t: "kv", label: nlDate(a.created_at), value: a.label });
  }
  return blocks;
}

export function timelineBlocks(items: Array<{ occurred_at: string; label: string; category: string }>): Block[] {
  const blocks: Block[] = [{ t: "heading", text: "Tijdlijn" }];
  if (items.length === 0) {
    blocks.push({ t: "muted", text: "Nog geen gebeurtenissen." });
    return blocks;
  }
  for (const item of items) {
    blocks.push({ t: "kv", label: nlDate(item.occurred_at), value: item.label });
  }
  return blocks;
}

export function appointmentLabel(
  appt: { appointment_date: string; start_time: string | null } | null,
  serviceName: string | null,
): string | null {
  if (!appt) return null;
  const date = nlDate(appt.appointment_date);
  const time = appt.start_time ? ` om ${String(appt.start_time).slice(0, 5)}` : "";
  return `${serviceName ? serviceName + " op " : ""}${date}${time}`;
}
